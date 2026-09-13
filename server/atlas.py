"""Validate a sprite-gen runtime atlas before importing any frame."""
import base64
import hashlib
import io
import math
import uuid
import json

from PIL import Image
from .store import now


def positive_number(value, label, upper=60000):
    if type(value) not in (int, float) or not math.isfinite(value) or not 0 < value <= upper:
        raise ValueError(f"{label} 값이 올바르지 않습니다.")
    return value


def parse_atlas(payload):
    manifest = payload.get("manifest")
    if not isinstance(manifest, dict):
        raise ValueError("sprite-gen manifest.json이 필요합니다.")
    layout = manifest.get("frame_layout")
    animation = manifest.get("animation")
    if not isinstance(layout, dict) or not isinstance(animation, dict):
        raise ValueError("frame_layout과 animation이 있는 런타임 manifest가 필요합니다.")
    rows, timing = layout.get("rows"), animation.get("rows")
    if not isinstance(rows, dict) or not rows or not isinstance(timing, dict) or set(rows) != set(timing):
        raise ValueError("프레임 좌표와 애니메이션 상태가 일치하지 않습니다.")
    if len(rows) > 64:
        raise ValueError("한 번에 최대 64개 상태를 가져올 수 있습니다.")
    encoded = payload.get("png")
    if not isinstance(encoded, str) or not encoded.startswith("data:image/png;base64,"):
        raise ValueError("manifest와 함께 PNG 시트를 선택해 주세요.")
    try:
        data = base64.b64decode(encoded.split(",", 1)[1], validate=True)
        if len(data) > 12 * 1024 * 1024:
            raise ValueError("PNG 시트는 12MB 이하여야 합니다.")
        with Image.open(io.BytesIO(data)) as image:
            if image.format != "PNG" or max(image.size) > 8192 or image.width * image.height > 16_777_216:
                raise ValueError("PNG 시트는 최대 8192px, 총 16메가픽셀 이하여야 합니다.")
            if image.size != (layout.get("sheetWidth"), layout.get("sheetHeight")):
                raise ValueError("선택한 PNG 크기가 manifest의 시트 크기와 다릅니다.")
            image.load()
            sheet = image.convert("RGBA")
    except (OSError, Image.DecompressionBombError) as exc:
        raise ValueError("PNG 시트를 읽을 수 없습니다.") from exc
    # Validate every rectangle and timing entry before cropping or writing.
    plans = []
    pixel_budget, total_frames = 0, 0
    character = manifest.get("characterId", "sprite-gen")
    if not isinstance(character, str):
        raise ValueError("캐릭터 이름이 올바르지 않습니다.")
    digest = hashlib.sha256(data).hexdigest()
    for state, rects in rows.items():
        if not isinstance(state, str) or not state.strip() or len(state) > 120:
            raise ValueError("상태 이름은 1~120자여야 합니다.")
        row = timing[state]
        if not isinstance(rects, list) or not rects or not isinstance(row, dict):
            raise ValueError("상태에 유효한 프레임이 없습니다.")
        if type(row.get("frames")) is not int or row["frames"] != len(rects):
            raise ValueError("요청된 프레임 수와 좌표 수가 다릅니다.")
        fps = positive_number(row.get("fps"), "FPS", 60)
        if fps < 1:
            raise ValueError("FPS는 1 이상이어야 합니다.")
        if type(row.get("loop")) is not bool:
            raise ValueError("상태의 loop 값이 필요합니다.")
        durations = row.get("durations_ms", [1000 / fps] * len(rects))
        if not isinstance(durations, list) or len(durations) != len(rects):
            raise ValueError("프레임 시간 수가 좌표 수와 다릅니다.")
        for duration in durations:
            positive_number(duration, "프레임 시간")
        total_frames += len(rects)
        if total_frames > 256:
            raise ValueError("한 번에 최대 256프레임을 가져올 수 있습니다.")
        for rect in rects:
            if not isinstance(rect, dict) or any(type(rect.get(k)) is not int for k in ("x", "y", "w", "h")):
                raise ValueError("프레임 좌표는 정수여야 합니다.")
            x, y, w, h = (rect[k] for k in ("x", "y", "w", "h"))
            if x < 0 or y < 0 or not 1 <= w <= 2048 or not 1 <= h <= 2048 or x + w > sheet.width or y + h > sheet.height:
                raise ValueError("프레임 좌표가 시트 밖에 있거나 크기가 너무 큽니다.")
            pixel_budget += w * h
            if pixel_budget > 16_777_216:
                raise ValueError("총 프레임 픽셀 수가 너무 큽니다.")
        if len({(r["w"], r["h"]) for r in rects}) != 1:
            raise ValueError("한 상태의 프레임은 같은 셀 크기여야 합니다.")
        plans.append((state, rects, durations, fps, row["loop"]))
    assets, clips = [], []
    for state, rects, durations, fps, loop in plans:
        frames = []
        for index, rect in enumerate(rects):
            asset_id = str(uuid.uuid4())
            x, y, w, h = (rect[k] for k in ("x", "y", "w", "h"))
            image = sheet.crop((x, y, x + w, y + h))
            assets.append((image, {"id": asset_id, "name": f"{character} · {state} · {index + 1:02d}"[:120],
                                  "source": {"kind": "sprite-gen", "state": state, "index": index, "sheetSha256": digest, "rect": {"x": x, "y": y, "w": w, "h": h}}}))
            frames.append({"assetId": asset_id, "durationMs": durations[index]})
        clips.append({"id": str(uuid.uuid4()), "name": state, "frames": frames, "fps": fps, "loop": loop})
    return assets, clips


def import_atlas(store, payload):
    images, clips = parse_atlas(payload)
    return publish_images(store, images, clips)


def publish_images(store, images, clips):
    # PNG files are immutable and new. Metadata becomes visible in a single DB transaction.
    assets = []
    for image, meta in images:
        image.save(store.root / "assets" / f"{meta['id']}.png")
        assets.append({"parentId": None, **meta, "width": image.width, "height": image.height,
                       "createdAt": now(), "url": f"/api/assets/{meta['id']}/image"})
    with store.connect() as db:
        db.executemany("INSERT INTO assets VALUES (?, ?)", [(a["id"], json.dumps(a)) for a in assets])
    return {"assets": assets, "clips": clips}
