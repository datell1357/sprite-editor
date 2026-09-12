"""Local immutable PNG assets and durable job metadata."""
from __future__ import annotations

import base64
import io
import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

MAX_IMAGE_BYTES = 12 * 1024 * 1024
MAX_IMAGE_AXIS = 2048


def now():
    return datetime.now(timezone.utc).isoformat()


class Store:
    def __init__(self, root: Path):
        self.root = root
        (root / "assets").mkdir(parents=True, exist_ok=True)
        (root / "jobs").mkdir(exist_ok=True)
        with self.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, metadata TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, metadata TEXT NOT NULL);
            """)

    def connect(self):
        db = sqlite3.connect(self.root / "editor.sqlite", timeout=10)
        db.execute("PRAGMA journal_mode=WAL")
        return db

    def list(self, table):
        assert table in {"assets", "jobs"}
        with self.connect() as db:
            return [json.loads(row[0]) for row in db.execute(f"SELECT metadata FROM {table} ORDER BY rowid DESC")]

    def get(self, table, item_id):
        assert table in {"assets", "jobs"}
        with self.connect() as db:
            row = db.execute(f"SELECT metadata FROM {table} WHERE id=?", (item_id,)).fetchone()
        if not row:
            raise KeyError("항목을 찾을 수 없습니다.")
        return json.loads(row[0])

    def put(self, table, item):
        assert table in {"assets", "jobs"}
        with self.connect() as db:
            db.execute(f"INSERT OR REPLACE INTO {table} VALUES (?, ?)", (item["id"], json.dumps(item)))
        return item

    def image_path(self, asset_id):
        self.get("assets", asset_id)
        return self.root / "assets" / f"{asset_id}.png"

    def add_image(self, data: bytes, name: str, parent_id=None):
        if len(data) > MAX_IMAGE_BYTES:
            raise ValueError("이미지는 12MB 이하로 가져와 주세요.")
        if not isinstance(name, str) or not name.strip() or len(name) > 120:
            raise ValueError("자산 이름은 1~120자로 입력해 주세요.")
        if parent_id:
            self.get("assets", parent_id)
        try:
            with Image.open(io.BytesIO(data)) as source:
                if source.format != "PNG":
                    raise ValueError("PNG 이미지가 필요합니다.")
                if max(source.size) > MAX_IMAGE_AXIS:
                    raise ValueError("이미지의 각 변은 2048px 이하여야 합니다.")
                source.load()
                image = source.convert("RGBA")
        except (OSError, Image.DecompressionBombError) as exc:
            raise ValueError("PNG 이미지를 읽을 수 없습니다.") from exc
        asset_id = str(uuid.uuid4())
        path = self.root / "assets" / f"{asset_id}.png"
        image.save(path)
        return self.put("assets", {
            "id": asset_id, "name": name.strip(), "width": image.width, "height": image.height,
            "parentId": parent_id, "createdAt": now(), "url": f"/api/assets/{asset_id}/image",
        })

    def import_data_url(self, payload):
        encoded = payload.get("png", "")
        if not isinstance(encoded, str) or not encoded.startswith("data:image/png;base64,"):
            raise ValueError("PNG 데이터가 필요합니다.")
        try:
            data = base64.b64decode(encoded.split(",", 1)[1], validate=True)
        except ValueError as exc:
            raise ValueError("이미지 인코딩이 올바르지 않습니다.") from exc
        return self.add_image(data, payload.get("name", ""), payload.get("parentId"))
