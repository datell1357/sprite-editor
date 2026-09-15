"""Read a finished sprite-gen ZIP without extracting or executing its contents."""
import base64
import io
import json
import stat
import uuid
import zipfile
from pathlib import PurePosixPath

from PIL import Image

from .atlas import parse_atlas, positive_number, publish_images
from .store import now

MAX_ARCHIVE = 12 * 1024 * 1024
MAX_EXPANDED = 64 * 1024 * 1024


def safe_path(name):
    if not isinstance(name,str) or not name or len(name)>512 or '\\' in name or ':' in name:
        raise ValueError('ZIP 파일 경로가 올바르지 않습니다.')
    p=PurePosixPath(name)
    if p.is_absolute() or '..' in p.parts:
        raise ValueError('ZIP에 허용하지 않는 경로가 있습니다.')
    return p


def parse_run(data, max_clips=128):
    if len(data)>MAX_ARCHIVE: raise ValueError('작업 ZIP은 12MiB 이하여야 합니다.')
    if type(max_clips) is not int or not 1<=max_clips<=128: raise ValueError('추가 가능한 클립 수가 올바르지 않습니다.')
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entries=archive.infolist()
            if len(entries)>2048 or sum(e.file_size for e in entries)>MAX_EXPANDED:
                raise ValueError('ZIP은 최대 2048개 항목, 압축 해제 기준 64MiB입니다.')
            files={}
            for entry in entries:
                path=safe_path(entry.filename)
                if stat.S_ISLNK(entry.external_attr>>16) or entry.flag_bits&1:
                    raise ValueError('심볼릭 링크 또는 암호화 ZIP은 지원하지 않습니다.')
                if entry.compress_type not in (zipfile.ZIP_STORED,zipfile.ZIP_DEFLATED):
                    raise ValueError('ZIP은 store/deflate 압축만 지원합니다.')
                if entry.is_dir(): continue
                if path in files: raise ValueError('ZIP 안의 파일 경로가 중복됩니다.')
                files[path]=entry
            manifests=[p for p in files if p.name=='manifest.json']
            if len(manifests)!=1: raise ValueError('ZIP에 완성된 run의 manifest.json이 하나 있어야 합니다.')
            root=manifests[0].parent
            def read(relative, limit=MAX_ARCHIVE):
                name=root/safe_path(relative)
                entry=files.get(name)
                if not entry or entry.file_size>limit: raise ValueError('필수 파일이 없거나 파일 크기가 제한을 초과했습니다.')
                with archive.open(entry) as stream: result=stream.read(limit+1)
                if len(result)>limit: raise ValueError('압축 해제한 파일이 너무 큽니다.')
                return result
            def document(relative):
                value=json.loads(read(relative,2*1024*1024))
                if not isinstance(value,dict): raise ValueError('run의 JSON 객체가 올바르지 않습니다.')
                return value
            manifest=document('manifest.json')
            sheet=read(manifest.get('sprite_sheet_alpha','sprite-sheet-alpha.png'))
            images,clips=parse_atlas({'manifest':manifest,'png':'data:image/png;base64,'+base64.b64encode(sheet).decode()})
            request=document('sprite-request.json'); source=document('frames/frames-manifest.json')
            if source.get('ok') is not True or not isinstance(source.get('rows'),list) or not source['rows'] or not isinstance(request.get('states'),dict):
                raise ValueError('완료된 프레임 manifest와 생성 요청이 필요합니다.')
            by_state={c['name']:c for c in clips};seen=set();pixels=sum(i.width*i.height for i,_ in images)
            for row in source['rows']:
                if not isinstance(row,dict): raise ValueError('추출 프레임 행이 올바르지 않습니다.')
                state=row.get('state')
                if not isinstance(state,str) or not state.strip() or len(state)>120 or state in seen:
                    raise ValueError('추출 상태 이름이 없거나 중복됐습니다.')
                seen.add(state)
                settings=request['states'].get(state)
                if not isinstance(settings,dict): raise ValueError('추출 상태의 생성 요청이 없습니다.')
                fps=positive_number(settings.get('fps'),'원본 FPS',60)
                if fps<1 or type(settings.get('loop')) is not bool: raise ValueError('원본 재생 설정이 올바르지 않습니다.')
                paths=row.get('files')
                if not isinstance(paths,list) or not paths or type(row.get('frames')) is not int or row['frames']!=len(paths):
                    raise ValueError('추출 파일 목록과 프레임 수가 다릅니다.')
                if len(images)+len(paths)>256: raise ValueError('재생과 후보를 합쳐 최대 256프레임을 가져올 수 있습니다.')
                durations=row.get('durations_ms',[1000/fps]*len(paths))
                if not isinstance(durations,list) or len(durations)!=len(paths): raise ValueError('후보 프레임 시간 수가 다릅니다.')
                clip=by_state.get(state)
                if not clip:
                    clip={'id':str(uuid.uuid4()),'name':state,'frames':[],'fps':fps,'loop':settings['loop']};clips.append(clip)
                clip['candidates']=[]
                for index,path in enumerate(paths):
                    if not safe_path(path).is_relative_to(PurePosixPath('frames')):
                        raise ValueError('후보 PNG는 frames 디렉터리 안에 있어야 합니다.')
                    duration=positive_number(durations[index],'후보 시간')
                    with Image.open(io.BytesIO(read(path))) as opened:
                        if opened.format!='PNG' or max(opened.size)>2048:
                            raise ValueError('후보는 각 변 2048px 이하 PNG여야 합니다.')
                        pixels+=opened.width*opened.height
                        if pixels>16_777_216: raise ValueError('전체 프레임 픽셀 수가 너무 큽니다.')
                        opened.load();image=opened.convert('RGBA')
                    asset_id=str(uuid.uuid4())
                    images.append((image,{'id':asset_id,'name':f'{state} · 원본 후보 {index+1:02d}'[:120],
                        'source':{'kind':'sprite-gen-candidate','state':state,'index':index}}))
                    clip['candidates'].append({'assetId':asset_id,'durationMs':duration})
            if len(clips)>max_clips: raise ValueError('프로젝트에 추가할 수 있는 클립 수를 초과했습니다.')
            return images,clips
    except (zipfile.BadZipFile,NotImplementedError,RuntimeError,UnicodeDecodeError,OSError,Image.DecompressionBombError) as exc:
        raise ValueError('작업 ZIP 또는 PNG를 읽지 못했습니다.') from exc


def import_run(store,payload):
    encoded=payload.get('archive')
    if not isinstance(encoded,str): raise ValueError('작업 ZIP 데이터가 필요합니다.')
    try: data=base64.b64decode(encoded,validate=True)
    except ValueError as exc: raise ValueError('ZIP 인코딩이 올바르지 않습니다.') from exc
    images,clips=parse_run(data,payload.get('maxClips',128))
    import_id=str(uuid.uuid4());folder=store.root/'imports';folder.mkdir(exist_ok=True)
    (folder/f'{import_id}.zip').write_bytes(data)
    job={'id':import_id,'status':'completed','createdAt':now(),'finishedAt':now(),
         'request':{'kind':'import-run','prompt':'sprite-gen 작업 ZIP'},'clips':clips,'archiveUrl':f'/api/imports/{import_id}/archive'}
    result=publish_images(store,images,clips,job=job)
    return {**result,'archiveUrl':job['archiveUrl']}
