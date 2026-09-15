"""Validate sprite-gen and editor atlases before importing any frame."""
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


def normalized_pivot(value):
    if not isinstance(value, dict) or any(type(value.get(k)) not in (int, float) or
            not math.isfinite(value[k]) or not 0 <= value[k] <= 1 for k in ('x', 'y')):
        raise ValueError('아틀라스 피벗은 0~1의 좌표여야 합니다.')
    return {k: value[k] for k in ('x', 'y')}


def editor_alignment(manifest):
    """Validate the editable source rectangles against the rendered cell geometry."""
    frames = manifest['frames']
    pivot = normalized_pivot(manifest.get('sourcePivot'))
    output_pivot = normalized_pivot(manifest.get('pivot'))
    if any(type(manifest.get(k)) is not int or not 1 <= manifest[k] <= 8192 for k in ('sheetWidth', 'sheetHeight')):
        raise ValueError('아틀라스 시트 크기가 올바르지 않습니다.')
    if manifest['sheetWidth'] * manifest['sheetHeight'] > 16_777_216:
        raise ValueError('PNG 시트는 총 16메가픽셀 이하여야 합니다.')
    sources, offsets = [], []
    for f in frames:
        r = f.get('sourceRect')
        if not isinstance(r, dict) or any(type(r.get(k)) is not int for k in ('x', 'y', 'w', 'h')):
            raise ValueError('원본 프레임 영역이 올바르지 않습니다.')
        if not 1 <= r['w'] <= 2048 or not 1 <= r['h'] <= 2048:
            raise ValueError('원본 프레임은 각 변 2048px 이하여야 합니다.')
        if any(type(f.get(k)) is not int or abs(f[k]) > 2048 for k in ('offsetX', 'offsetY')):
            raise ValueError('프레임 위치는 -2048~2048px 정수여야 합니다.')
        if (f['x'] < 0 or f['y'] < 0 or not 1 <= f['w'] <= 8192 or not 1 <= f['h'] <= 8192 or
                f['x'] + f['w'] > manifest['sheetWidth'] or f['y'] + f['h'] > manifest['sheetHeight'] or
                r['x'] < f['x'] or r['y'] < f['y'] or r['x'] + r['w'] > f['x'] + f['w'] or r['y'] + r['h'] > f['y'] + f['h']):
            raise ValueError('원본 영역 또는 출력 셀이 시트 밖에 있습니다.')
        sources.append({k: r[k] for k in ('x', 'y', 'w', 'h')})
        offsets.append({k: f[k] for k in ('offsetX', 'offsetY')})
    base_w, base_h = max(r['w'] for r in sources), max(r['h'] for r in sources)
    raw = [((base_w-r['w'])//2 + f['offsetX'], base_h-r['h'] + f['offsetY']) for r,f in zip(sources,frames)]
    left, top = min(0, *(x for x,_ in raw)), min(0, *(y for _,y in raw))
    width = max(base_w, *(x+r['w'] for (x,y),r in zip(raw,sources))) - left
    height = max(base_h, *(y+r['h'] for (x,y),r in zip(raw,sources))) - top
    if width * height * len(frames) > 16_777_216:
        raise ValueError('정렬된 프레임의 총 픽셀 수가 너무 큽니다.')
    expected_pivot = {'x': (math.floor(base_w*pivot['x']+0.5)-left)/width,
                      'y': (math.floor(base_h*pivot['y']+0.5)-top)/height}
    if any(not math.isclose(output_pivot[k], expected_pivot[k], abs_tol=1e-9, rel_tol=0) for k in ('x','y')):
        raise ValueError('출력 피벗과 원본 피벗이 일치하지 않습니다.')
    for f,r,(x,y) in zip(frames,sources,raw):
        if (f['w'],f['h']) != (width,height) or (r['x'],r['y']) != (f['x']+x-left,f['y']+y-top):
            raise ValueError('프레임 위치와 출력 영역이 일치하지 않습니다.')
    return sources, offsets, pivot


def normalize_manifest(manifest):
    """Accept the editor's existing atlas export without changing its pixels."""
    if 'frame_layout' in manifest or 'animation' in manifest:
        return manifest, None
    if type(manifest.get('version')) is not int or manifest['version'] not in (1, 2) or not isinstance(manifest.get('frames'), list):
        raise ValueError('sprite-gen manifest 또는 Sprite Editor 아틀라스 JSON이 필요합니다.')
    name = manifest.get('name')
    if not isinstance(name, str) or not name.strip() or len(name) > 120:
        raise ValueError('클립 이름은 1~120자여야 합니다.')
    frames = manifest['frames']
    if not 1 <= len(frames) <= 256:
        raise ValueError('아틀라스에는 1~256프레임이 필요합니다.')
    variant = manifest.get('variant')
    if variant is not None and variant not in ('plain', 'pixel-unfake'):
        raise ValueError('지원하지 않는 픽셀 처리 종류입니다.')
    rects, durations = [], []
    for frame in frames:
        if not isinstance(frame, dict) or any(type(frame.get(k)) is not int for k in ('x', 'y', 'w', 'h')):
            raise ValueError('프레임 좌표는 정수여야 합니다.')
        rects.append({k: frame[k] for k in ('x', 'y', 'w', 'h')})
        durations.append(positive_number(frame.get('duration'), '프레임 시간(초)', 60) * 1000)
    alignment = {}
    sheet = {}
    if manifest['version'] == 2:
        rects, offsets, pivot = editor_alignment(manifest)
        alignment = {'offsets': offsets, 'pivot': pivot}
        sheet = {k: manifest[k] for k in ('sheetWidth', 'sheetHeight')}
    # Legacy exports take sheet dimensions from the PNG; v2 declares them.
    # A partially empty last row is allowed in either version.
    return {
        'characterId': 'Sprite Editor',
        'frame_layout': {'rows': {name: rects}, **sheet},
        'animation': {'rows': {name: {'frames': len(rects), 'fps': manifest.get('fps'),
                                    'loop': manifest.get('loop'), 'durations_ms': durations, **alignment}}},
    }, variant


def parse_atlas(payload):
    manifest = payload.get("manifest")
    if not isinstance(manifest, dict):
        raise ValueError("sprite-gen manifest.json이 필요합니다.")
    editor_export = 'frame_layout' not in manifest and 'animation' not in manifest
    aligned_editor = editor_export and type(manifest.get('version')) is int and manifest['version'] == 2
    manifest, variant = normalize_manifest(manifest)
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
            if (not editor_export or aligned_editor) and image.size != (layout.get("sheetWidth"), layout.get("sheetHeight")):
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
        if not aligned_editor and len({(r["w"], r["h"]) for r in rects}) != 1:
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
                                  **({'processing': variant} if variant else {}),
                                  "source": {"kind": "sprite-editor" if editor_export else "sprite-gen", "state": state, "index": index, "sheetSha256": digest, "rect": {"x": x, "y": y, "w": w, "h": h}}}))
            frames.append({"assetId": asset_id, "durationMs": durations[index],
                           **(timing[state]['offsets'][index] if aligned_editor else {})})
        clips.append({"id": str(uuid.uuid4()), "name": state, "frames": frames, "fps": fps, "loop": loop,
                      **({'variant': variant} if variant else {}),
                      **({'pivot': timing[state]['pivot']} if aligned_editor else {})})
    return assets, clips


def import_atlas(store, payload):
    images, clips = parse_atlas(payload)
    return publish_images(store, images, clips)


def publish_images(store, images, clips, job=None):
    # PNG files are immutable and new. Metadata becomes visible in a single DB transaction.
    assets = []
    for image, meta in images:
        image.save(store.root / "assets" / f"{meta['id']}.png")
        assets.append({"parentId": None, **meta, "width": image.width, "height": image.height,
                       "createdAt": now(), "url": f"/api/assets/{meta['id']}/image"})
    with store.connect() as db:
        db.executemany("INSERT INTO assets VALUES (?, ?)", [(a["id"], json.dumps(a)) for a in assets])
        if job:
            db.execute('INSERT INTO jobs VALUES (?, ?)', (job['id'], json.dumps(job)))
    return {"assets": assets, "clips": clips}
