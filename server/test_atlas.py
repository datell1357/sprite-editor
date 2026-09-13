import base64
import io
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
