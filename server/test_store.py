import base64
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from server.jobs import Jobs
from server.store import Store


def png(size=(8, 8)):
    buffer = io.BytesIO()
    Image.new("RGBA", size, (20, 100, 30, 128)).save(buffer, "PNG")
    return buffer.getvalue()


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = Store(Path(self.temp.name))

    def test_revisions_preserve_original_pixels_and_references(self):
        first = self.store.add_image(png(), "source")
        original = self.store.image_path(first["id"]).read_bytes()
        second = self.store.add_image(png((16, 16)), "edited", first["id"])
        self.assertNotEqual(first["id"], second["id"])
        self.assertEqual(second["parentId"], first["id"])
        self.assertEqual(self.store.image_path(first["id"]).read_bytes(), original)

    def test_invalid_image_and_reference_publish_nothing(self):
        for data in (b"not png", png((2049, 1))):
            with self.assertRaises(ValueError):
                self.store.add_image(data, "bad")
        with self.assertRaises(KeyError):
            self.store.add_image(png(), "bad parent", "../escape")
        self.assertEqual(self.store.list("assets"), [])

    def test_data_url_import_survives_reopening_store(self):
        item = self.store.import_data_url({"name": "가져온 이미지", "png": "data:image/png;base64," + base64.b64encode(png()).decode()})
        other = Store(Path(self.temp.name))
        self.assertEqual(other.get("assets", item["id"])["width"], 8)

    def test_restart_marks_incomplete_jobs_without_retry(self):
        self.store.put("jobs", {"id": "stopped", "status": "running", "request": {}})
        Jobs(self.store)
        self.assertEqual(self.store.get("jobs", "stopped")["status"], "failed")

    def test_provider_and_numeric_inputs_are_validated(self):
        jobs = Jobs(self.store)
        with patch("server.jobs.find_sprite_gen", return_value="sprite-gen"):
            for provider, size in [("shell", 32), ("codex", -1)]:
                with self.assertRaises(ValueError):
                    jobs.submit({"kind": "generate", "provider": provider, "size": size, "prompt": "test"})


if __name__ == "__main__":
    unittest.main()
