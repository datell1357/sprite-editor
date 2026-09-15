import base64
import copy
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from server.atlas import import_atlas, parse_atlas
from server.store import Store


def fixture():
    image = Image.new("RGBA", (8, 4))
    image.paste((20, 120, 50, 128), (0, 0, 4, 4))
    image.paste((250, 20, 70, 255), (4, 0, 8, 4))
    buf = io.BytesIO(); image.save(buf, "PNG")
    return {"png": "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode(),
            "manifest": {"characterId": "fixture", "frame_layout": {"sheetWidth": 8, "sheetHeight": 4, "rows": {
                "attack": [{"x": 0, "y": 0, "w": 4, "h": 4}, {"x": 4, "y": 0, "w": 4, "h": 4}]}},
                "animation": {"rows": {"attack": {"frames": 2, "fps": 8, "loop": False, "durations_ms": [125, 375]}}}}}


class AtlasTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        self.store = Store(Path(temp.name))

    def aligned_export(self):
        spec = json.loads((Path(__file__).parents[1] / 'test-fixtures/animation-alignment.json').read_text())
        manifest = spec['manifest']
        image = Image.new('RGBA', (manifest['sheetWidth'], manifest['sheetHeight']))
        for index, frame in enumerate(manifest['frames']):
            r = frame['sourceRect']
            source = Image.new('RGBA', (r['w'], r['h']), (30+index*50, 70, 150, 128+index*50))
            source.putpixel((0, 0), (0, 0, 0, 0))
            image.paste(source, (r['x'], r['y']))
        buf = io.BytesIO(); image.save(buf, 'PNG')
        return {'manifest': manifest, 'png': 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()}, spec

    def test_aligned_export_restores_editable_source_sizes_offsets_and_pivot(self):
        payload, spec = self.aligned_export(); original = copy.deepcopy(payload)
        result = import_atlas(self.store, payload)
        self.assertEqual(payload, original)
        clip = result['clips'][0]
        self.assertEqual(clip['pivot'], spec['clip']['pivot'])
        self.assertEqual((clip['name'],clip['fps'],clip['loop'],clip['variant']), ('Aligned walk',8,False,'plain'))
        for index, (frame, asset, expected) in enumerate(zip(clip['frames'], result['assets'], spec['clip']['frames'])):
            self.assertEqual({k:frame[k] for k in ('durationMs','offsetX','offsetY')}, {k:expected[k] for k in ('durationMs','offsetX','offsetY')})
            self.assertEqual((asset['width'],asset['height']), (spec['assets'][index]['width'],spec['assets'][index]['height']))
            self.assertEqual(frame['assetId'],asset['id'])
            with Image.open(self.store.image_path(asset['id'])) as image:
                self.assertEqual(image.getpixel((0,0)), (0,0,0,0))
                self.assertEqual(image.getpixel((1,1)), (30+index*50,70,150,128+index*50))

    def test_aligned_export_rejects_inconsistent_geometry_before_publishing(self):
        edits = [lambda m:m.update(sourcePivot={'x':0.5,'y':True}),
                 lambda m:m.update(pivot={'x':float('nan'),'y':0}),
                 lambda m:m.update(pivot={'x':0,'y':0}),
                 lambda m:m.update(sheetWidth=40),
                 lambda m:m['frames'][1].update(offsetX=1.5),
                 lambda m:m['frames'][1].update(offsetY=True),
                 lambda m:m['frames'][1].update(offsetX=2049),
                 lambda m:m['frames'][2].update(offsetX=0),
                 lambda m:m['frames'][2]['sourceRect'].update(x=28),
                 lambda m:m['frames'][2]['sourceRect'].update(w=2049),
                 lambda m:m['frames'][2].update(w=14),
                 lambda m:m['frames'][1].pop('sourceRect')]
        for edit in edits:
            payload,_ = self.aligned_export(); edit(payload['manifest'])
            with self.assertRaises(ValueError): import_atlas(self.store,payload)
            self.assertEqual(self.store.list('assets'), [])
            self.assertEqual(list((self.store.root / 'assets').iterdir()), [])

    def editor_export(self):
        payload = fixture()
        payload['manifest'] = {
            'version': 1, 'image': 'sprite-atlas.png', 'name': 'up_attack',
            'fps': 8, 'loop': False, 'variant': 'plain',
            'frames': [
                {'x': 0, 'y': 0, 'w': 4, 'h': 4, 'offsetX': 1, 'offsetY': 0, 'duration': .125, 'assetId': 'old-a'},
                {'x': 4, 'y': 0, 'w': 4, 'h': 4, 'offsetX': 0, 'offsetY': 1, 'duration': .375, 'assetId': 'old-b'},
            ],
        }
        return payload

    def test_editor_export_restores_pixels_variable_timing_and_variant(self):
        payload = self.editor_export(); original = copy.deepcopy(payload)
        result = import_atlas(self.store, payload)
        self.assertEqual(payload, original)
        clip = result['clips'][0]
        self.assertEqual((clip['name'], clip['fps'], clip['loop'], clip['variant']), ('up_attack', 8, False, 'plain'))
        self.assertEqual([f['durationMs'] for f in clip['frames']], [125, 375])
        for asset, pixel in zip(result['assets'], [(20,120,50,128), (250,20,70,255)]):
            self.assertEqual(asset['processing'], 'plain')
            self.assertEqual(asset['source']['kind'], 'sprite-editor')
            self.assertIsNone(asset['parentId'])
            with Image.open(self.store.image_path(asset['id'])) as image:
                # Offsets describe placement already baked into the sheet;
                # import must not apply them a second time.
                self.assertEqual(image.size, (4,4))
                self.assertEqual(image.getpixel((0,0)), pixel)

    def test_editor_export_rejects_bad_time_bounds_and_variant_before_publication(self):
        for edit in [lambda m: m.update(version=True), lambda m: m.update(variant='unknown'),
                     lambda m: m.update(frames=[]), lambda m: m.update(loop='false'),
                     lambda m: m['frames'][1].update(duration=True),
                     lambda m: m['frames'][1].update(duration=61),
                     lambda m: m['frames'][1].update(duration=float('nan')),
                     lambda m: m['frames'][1].update(x=8)]:
            payload = self.editor_export(); edit(payload['manifest'])
            with self.assertRaises(ValueError): import_atlas(self.store, payload)
            self.assertEqual(self.store.list('assets'), [])

    def test_editor_export_with_partial_last_grid_row_keeps_baked_cell_order(self):
        payload = self.editor_export()
        buf = io.BytesIO(); image = Image.new('RGBA', (8,8))
        for color, box in [((1,2,3,255),(0,0,4,4)), ((4,5,6,128),(4,0,8,4)), ((7,8,9,255),(0,4,4,8))]:
            image.paste(color, box)
        image.save(buf, 'PNG')
        payload['png'] = 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()
        payload['manifest']['frames'].append({'x':0,'y':4,'w':4,'h':4,'duration':.2})
        images, clips = parse_atlas(payload)
        self.assertEqual([im.getpixel((0,0)) for im,_ in images], [(1,2,3,255),(4,5,6,128),(7,8,9,255)])
        self.assertEqual([f['durationMs'] for f in clips[0]['frames']], [125,375,200])

    def test_pixels_alpha_and_per_frame_timing_survive(self):
        result = import_atlas(self.store, fixture())
        self.assertEqual([f["durationMs"] for f in result["clips"][0]["frames"]], [125, 375])
        self.assertFalse(result["clips"][0]["loop"])
        for asset, pixel in zip(result["assets"], [(20, 120, 50, 128), (250, 20, 70, 255)]):
            with Image.open(self.store.image_path(asset["id"])) as im:
                self.assertEqual(im.size, (4, 4)); self.assertEqual(im.getpixel((0, 0)), pixel)

    def test_rejects_late_bad_rectangle_before_any_publish(self):
        payload = fixture(); payload["manifest"]["frame_layout"]["rows"]["attack"][1]["x"] = 100
        with self.assertRaises(ValueError): import_atlas(self.store, payload)
        self.assertEqual(self.store.list("assets"), [])
        self.assertEqual(list((self.store.root / "assets").iterdir()), [])

    def test_schema_and_timing_must_agree(self):
        for edit in [lambda p: p["manifest"]["frame_layout"].update(sheetWidth=100),
                     lambda p: p["manifest"]["animation"]["rows"]["attack"].update(frames=3),
                     lambda p: p["manifest"]["animation"]["rows"]["attack"].update(durations_ms=[125, 0]),
                     lambda p: p["manifest"]["animation"]["rows"]["attack"].update(durations_ms=[float('nan'), 125]),
                     lambda p: p["manifest"]["animation"]["rows"]["attack"].update(fps=0.5),
                     lambda p: p["manifest"]["animation"]["rows"]["attack"].update(loop="false")]:
            payload = fixture(); edit(payload)
            with self.assertRaises(ValueError): parse_atlas(payload)

    def test_uniform_fps_is_used_only_when_durations_are_absent(self):
        payload = fixture(); del payload["manifest"]["animation"]["rows"]["attack"]["durations_ms"]
        _, clips = parse_atlas(payload)
        self.assertEqual([f["durationMs"] for f in clips[0]["frames"]], [125, 125])

    def test_write_failure_does_not_expose_partial_batch(self):
        original = Image.Image.save
        count = 0
        def fail_second(image, *args, **kwargs):
            nonlocal count
            count += 1
            if count == 2: raise OSError("disk full")
            return original(image, *args, **kwargs)
        payload = fixture()
        with patch.object(Image.Image, "save", fail_second), self.assertRaises(OSError):
            import_atlas(self.store, payload)
        self.assertEqual(self.store.list("assets"), [])
