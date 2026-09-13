"""One approved reference -> one GPT row -> checked runtime atlas."""
import base64
import json
import uuid
from PIL import Image
from .atlas import parse_atlas, publish_images

STATES = {"idle", "walk", "run", "attack", "jump"}


def validate_animation(payload, store):
    if payload.get("provider") != "codex":
        raise ValueError("이미지 행 애니메이션은 GPT 제공자를 사용합니다.")
    if payload.get("accessConfirmed") is not True:
        raise ValueError("GPT 이미지 생성 이용 권한을 확인해 주세요.")
    if not isinstance(payload.get("state"), str) or payload["state"] not in STATES:
        raise ValueError("애니메이션 상태가 올바르지 않습니다.")
    if type(payload.get("frames")) is not int or not 2 <= payload["frames"] <= 16:
        raise ValueError("프레임 수는 2~16이어야 합니다.")
    if type(payload.get("fps")) is not int or not 1 <= payload["fps"] <= 60:
        raise ValueError("FPS는 1~60이어야 합니다.")
    if type(payload.get("loop")) is not bool:
        raise ValueError("반복 여부를 지정해 주세요.")
    reference = payload.get("referenceId")
    if not isinstance(reference, str) or not reference:
        raise ValueError("기준 자산을 선택해 주세요.")
    store.get("assets", reference)


def animation_plan(binary, payload, reference, folder):
    run = folder / "run"
    recipe = folder / "recipe.json"
    state = payload["state"]
    recipe.write_text(json.dumps({
        "states": {state: {"frames": payload["frames"], "fps": payload["fps"], "loop": payload["loop"],
                           "action": payload["prompt"] + ". Keep the reference facing and character identity."}},
        "fit": {"pixel_unfake": True, "logical_height": payload["size"], "palette_size": 24,
                "align_x": "foot-centroid", "align_y": "bottom", "ground_frames": state != "jump"},
    }))
    return [
        ("access", [binary, "workflow", "--kind", "sprite", "--base-image", str(reference),
                    "--motion-method", "gpt-rows", "--confirmed-access", "codex"]),
        ("prepare", [binary, "prepare", "--out-dir", str(run), "--character-id", "asset-" + payload["referenceId"],
                     "--base-image", str(reference), "--cell-size", str(payload["size"]), "--request", str(recipe)]),
        ("generate", [binary, "gen-set", "--run-dir", str(run), "--provider", "codex", "--states", state, "--concurrency", "1"]),
        ("extract", [binary, "extract", "--run-dir", str(run)]),
        ("compose", [binary, "compose-atlas", "--run-dir", str(run)]),
        ("inspect", [binary, "inspect", "--run-dir", str(run), "--report", str(folder / "qa.json")]),
    ]


def animation_output(folder, payload):
    manifest = json.loads((folder / "run/manifest.json").read_text())
    report = json.loads((folder / "qa.json").read_text())
    if not isinstance(report, dict) or report.get("ok") is not True:
        raise ValueError("생성된 애니메이션이 검사를 통과하지 못했습니다.")
    state = payload["state"]
    layout, timing = manifest.get("frame_layout", {}), manifest.get("animation", {}).get("rows", {})
    if set(layout.get("rows", {})) != {state} or set(timing) != {state}:
        raise ValueError("생성된 상태가 요청과 다릅니다.")
    if len(layout["rows"][state]) != payload["frames"] or timing[state].get("frames") != payload["frames"]:
        raise ValueError("생성된 프레임 수가 요청과 다릅니다.")
    if timing[state].get("fps") != payload["fps"] or timing[state].get("loop") is not payload["loop"]:
        raise ValueError("생성된 재생 설정이 요청과 다릅니다.")
    if layout.get("cellWidth") != payload["size"] or layout.get("cellHeight") != payload["size"]:
        raise ValueError("생성된 셀 크기가 요청과 다릅니다.")
    sheet = (folder / "run/sprite-sheet-alpha.png").read_bytes()
    return {"manifest": manifest, "png": "data:image/png;base64," + base64.b64encode(sheet).decode()}


def publish_animation_variants(store, folder, payload, output):
    pixel_images, clips = parse_atlas(output)
    if output['manifest'].get('curation_applied'):
        raise ValueError('편집된 run은 자동 원본 쌍으로 가져올 수 없습니다.')
    frame_manifest = json.loads((folder / 'run/frames/frames-manifest.json').read_text())
    rows = frame_manifest.get('rows', [])
    matching = [row for row in rows if row.get('state') == payload['state']]
    if frame_manifest.get('ok') is not True or len(matching) != 1:
        raise ValueError('원본 쌍의 프레임 manifest가 올바르지 않습니다.')
    plain_files = matching[0].get('plain_files')
    if not isinstance(plain_files, list) or len(plain_files) != len(pixel_images):
        raise ValueError('정규화 전 프레임이 누락됐습니다. 픽셀 결과로 대체하지 않습니다.')
    frames_root = (folder / 'run/frames').resolve()
    plain_images, plain_frames = [], []
    for index, (relative, (pixel, meta)) in enumerate(zip(plain_files, pixel_images)):
        if not isinstance(relative, str): raise ValueError('원본 쌍 경로가 올바르지 않습니다.')
        path = (folder / 'run' / relative).resolve()
        if not path.is_relative_to(frames_root): raise ValueError('원본 쌍은 run의 frames 안에 있어야 합니다.')
        with Image.open(path) as image:
            if image.format != 'PNG' or image.size != pixel.size:
                raise ValueError('정규화 전후 프레임의 셀 크기가 다릅니다.')
            image.load(); plain = image.convert('RGBA')
        parent = str(uuid.uuid4())
        plain_images.append((plain, {'id':parent, 'name':(meta['name'] + ' · Plain')[:120], 'processing':'plain'}))
        meta['parentId'] = parent; meta['processing'] = 'pixel-unfake'
        plain_frames.append({'assetId':parent,'durationMs':clips[0]['frames'][index]['durationMs']})
    clips[0]['variant'] = 'pixel-unfake'
    plain_clip = {**clips[0], 'id':str(uuid.uuid4()), 'frames':plain_frames, 'variant':'plain'}
    return publish_images(store, plain_images + pixel_images, [clips[0], plain_clip])
