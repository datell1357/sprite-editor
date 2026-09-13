import base64
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from server.run_import import import_run,parse_run
from server.store import Store
from server.test_atlas import fixture


def files():
    data=fixture();manifest=data['manifest'];manifest['sprite_sheet_alpha']='sprite-sheet-alpha.png';manifest['curation_applied']=True
    buf=io.BytesIO();Image.new('RGBA',(4,4),(5,210,40,255)).save(buf,'PNG')
    return {'manifest.json':json.dumps(manifest).encode(),'sprite-sheet-alpha.png':base64.b64decode(data['png'].split(',')[1]),
        'sprite-request.json':json.dumps({'states':{'attack':{'fps':4,'loop':False}}}).encode(),
        'frames/frames-manifest.json':json.dumps({'ok':True,'rows':[{'state':'attack','frames':2,'files':['frames/attack/a.png','frames/attack/b.png']}]}).encode(),
        'frames/attack/a.png':buf.getvalue(),'frames/attack/b.png':buf.getvalue(),
        'raw/attack.png':buf.getvalue(),'curation.json':b'{"transforms":"already baked; never executed"}'}


def archive(contents=None, root='hero/'):
    stream=io.BytesIO()
    with zipfile.ZipFile(stream,'w',zipfile.ZIP_DEFLATED) as z:
        for name,data in (contents or files()).items():z.writestr(root+name,data)
    return stream.getvalue()


class RunImportTests(unittest.TestCase):
    def setUp(self):
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup);self.store=Store(Path(temp.name))

    def test_baked_playback_and_original_candidates_keep_distinct_pixels_and_times(self):
        data=archive();result=import_run(self.store,{'archive':base64.b64encode(data).decode()})
        clip=result['clips'][0]
        self.assertEqual([f['durationMs'] for f in clip['frames']],[125,375])
        self.assertEqual([f['durationMs'] for f in clip['candidates']],[250,250])
        with Image.open(self.store.image_path(clip['frames'][0]['assetId'])) as image:self.assertEqual(image.getpixel((0,0)),(20,120,50,128))
        with Image.open(self.store.image_path(clip['candidates'][0]['assetId'])) as image:self.assertEqual(image.getpixel((0,0)),(5,210,40,255))
        job=self.store.list('jobs')[0]
        self.assertEqual((self.store.root/'imports'/f"{job['id']}.zip").read_bytes(),data)
        self.assertEqual(result['archiveUrl'],job['archiveUrl']);self.assertEqual(len(self.store.list('assets')),4)

    def test_missing_late_candidate_publishes_nothing(self):
        content=files();del content['frames/attack/b.png']
        with self.assertRaises(ValueError):import_run(self.store,{'archive':base64.b64encode(archive(content)).decode()})
        self.assertEqual(self.store.list('assets'),[]);self.assertEqual(self.store.list('jobs'),[])
        self.assertFalse((self.store.root/'imports').exists())

    def test_rejects_traversal_duplicate_normalized_paths_and_multiple_runs(self):
        for extra in ({'../escape':b'x'},{'./manifest.json':b'{}'},{'other/manifest.json':b'{}'}):
            with self.assertRaises(ValueError):parse_run(archive(files()|extra))

    def test_rejects_symlink_and_excessive_expansion(self):
        data=io.BytesIO()
        with zipfile.ZipFile(data,'w') as z:
            entry=zipfile.ZipInfo('link');entry.external_attr=0o120777<<16;z.writestr(entry,'target')
        with self.assertRaises(ValueError):parse_run(data.getvalue())
        with patch('server.run_import.MAX_EXPANDED',10),self.assertRaises(ValueError):parse_run(archive())

    def test_rejects_bad_source_timing_and_outside_frame_reference(self):
        for patch_doc in ('timing','path'):
            content=files()
            if patch_doc=='timing':content['sprite-request.json']=b'{"states":{"attack":{"fps":0,"loop":false}}}'
            else:
                manifest=json.loads(content['frames/frames-manifest.json']);manifest['rows'][0]['files'][0]='raw/attack.png';content['frames/frames-manifest.json']=json.dumps(manifest).encode()
            with self.assertRaises(ValueError):parse_run(archive(content))

    def test_valid_archive_root_and_clip_capacity_are_explicit(self):
        images,clips=parse_run(archive(root=''),1);self.assertEqual((len(images),len(clips)),(4,1))
        with self.assertRaises(ValueError):parse_run(archive(),0)
