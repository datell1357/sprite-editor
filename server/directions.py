"""Generate explicit direction anchors; never infer approval or mirror assets."""
import base64
import json

from .atlas import parse_atlas,publish_images

FACING = {
    'down':'front view, facing the viewer',
    'right':'pure side profile facing screen right',
    'up':'back view, facing away from the viewer, no visible face',
    'left':'pure side profile facing screen left',
    'down45_right':'three-quarter front view, facing diagonally toward the viewer and screen right',
    'up45_right':'three-quarter rear view, facing diagonally away and screen right',
    'up45_left':'three-quarter rear view, facing diagonally away and screen left',
    'down45_left':'three-quarter front view, facing diagonally toward the viewer and screen left',
}


def validate_directions(payload,store):
    directions=payload.get('directions')
    if not isinstance(directions,list) or not 1<=len(directions)<=8 or any(not isinstance(d,str) or d not in FACING for d in directions):
        raise ValueError('생성할 방향을 1~8개 선택해 주세요.')
    if len(set(directions))!=len(directions):raise ValueError('생성 방향이 중복됩니다.')
    if payload.get('provider')!='codex' or payload.get('accessConfirmed') is not True:
        raise ValueError('GPT 이미지 생성 이용 권한을 확인해 주세요.')
    reference=payload.get('referenceId')
    if not isinstance(reference,str) or not reference:raise ValueError('기준 자산을 선택해 주세요.')
    store.get('assets',reference)


def direction_plan(binary,payload,reference,folder):
    run=folder/'run';recipe=folder/'recipe.json'
    states={f'{d}_idle':{'frames':1,'fps':1,'loop':False,
        'action':f"{payload['prompt']}. One full-body neutral idle pose, {FACING[d]}. Change only the facing. Preserve identity and side-specific details. No mirror-image shortcut."} for d in payload['directions']}
    recipe.write_text(json.dumps({'directions':{'set':payload['directions'],'anchor_suffix':'idle'},'states':states,
        'fit':{'pixel_unfake':True,'logical_height':payload['size'],'palette_size':24,'align_x':'foot-centroid','align_y':'bottom','ground_frames':True}}))
    return [
        ('access',[binary,'workflow','--kind','sprite','--base-image',str(reference),'--motion-method','gpt-rows','--confirmed-access','codex']),
        ('prepare',[binary,'prepare','--out-dir',str(run),'--character-id','asset-'+payload['referenceId'],'--base-image',str(reference),'--cell-size',str(payload['size']),'--request',str(recipe)]),
        ('generate',[binary,'gen-set','--run-dir',str(run),'--provider','codex','--states',','.join(states),'--concurrency','1']),
        ('extract',[binary,'extract','--run-dir',str(run)]),
        ('compose',[binary,'compose-atlas','--run-dir',str(run)]),
        ('inspect',[binary,'inspect','--run-dir',str(run),'--report',str(folder/'qa.json')]),
    ]


def publish_directions(store,folder,payload):
    manifest=json.loads((folder/'run/manifest.json').read_text())
    qa=json.loads((folder/'qa.json').read_text())
    expected={f'{d}_idle' for d in payload['directions']}
    layout=manifest.get('frame_layout',{})
    if qa.get('ok') is not True or manifest.get('degraded_static_fallback') is True:
        raise ValueError('방향 기준이 검사를 통과하지 못했습니다.')
    if set(layout.get('rows',{}))!=expected or layout.get('cellWidth')!=payload['size'] or layout.get('cellHeight')!=payload['size']:
        raise ValueError('생성된 방향 또는 셀 크기가 요청과 다릅니다.')
    images,clips=parse_atlas({'manifest':manifest,'png':'data:image/png;base64,'+base64.b64encode((folder/'run/sprite-sheet-alpha.png').read_bytes()).decode()})
    by_name={c['name']:c for c in clips}
    if any(len(c['frames'])!=1 or c['loop'] or c['fps']!=1 for c in clips):
        raise ValueError('방향별 기준은 한 프레임이어야 합니다.')
    anchors=[{'direction':d,'assetId':by_name[f'{d}_idle']['frames'][0]['assetId']} for d in payload['directions']]
    for image,metadata in images:
        if not image.getchannel('A').getbbox():raise ValueError('빈 방향 기준 이미지는 등록할 수 없습니다.')
        metadata['processing']='pixel-unfake'
        metadata['parentId']=payload['referenceId']
    result=publish_images(store,images,[])
    return {'directionAnchors':anchors,'assetIds':[a['id'] for a in result['assets']]}
