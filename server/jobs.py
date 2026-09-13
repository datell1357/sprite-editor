"""One local worker. Never run client-supplied commands or overwrite input assets."""
from __future__ import annotations

import os
import queue
import shutil
import signal
import subprocess
import threading
import time
import uuid
from pathlib import Path

from .store import now
from .animation import validate_animation, animation_plan, animation_output, publish_animation_variants
from .directions import validate_directions,direction_plan,publish_directions

JOB_TIMEOUT_SECONDS = 1200
TERMINATION_GRACE_SECONDS = 5


def stop_process_group(process):
    """Terminate the owned session, including descendants, then reap its leader."""
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        process.wait()
        return
    # Do not reap the session leader until the group has been killed: this also
    # keeps its PID reserved while descendants receive their grace period.
    time.sleep(TERMINATION_GRACE_SECONDS)
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait(timeout=5)


def wait_for_process(process, cancelled, deadline=None):
    deadline = deadline if deadline is not None else time.monotonic() + JOB_TIMEOUT_SECONDS
    while True:
        if cancelled.is_set():
            stop_process_group(process)
            return None
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            stop_process_group(process)
            raise ValueError("작업 시간이 초과됐습니다. 제공자 상태와 기존 결과를 확인해 주세요.")
        try:
            code = process.wait(timeout=min(0.1, remaining))
            if cancelled.is_set():
                stop_process_group(process)
                return None
            return code
        except subprocess.TimeoutExpired:
            continue


def find_sprite_gen():
    configured = os.environ.get("SPRITE_GEN_BIN")
    if configured:
        return str(Path(configured).expanduser()) if Path(configured).expanduser().is_file() else None
    installed = Path.home() / ".codex/skills/sprite-gen/.venv/bin/sprite-gen"
    return str(installed) if installed.is_file() else shutil.which("sprite-gen")


def find_snapper():
    configured = os.environ.get("PIXEL_SNAPPER_BIN")
    if configured:
        return str(Path(configured).expanduser()) if Path(configured).expanduser().is_file() else None
    bundled = Path(__file__).resolve().parents[1] / "vendor/pixel-snapper/target/release/spritefusion-pixel-snapper"
    return str(bundled) if bundled.is_file() else shutil.which("spritefusion-pixel-snapper")


def capabilities():
    return {"spriteGen": bool(find_sprite_gen()), "pixelSnapper": bool(find_snapper()),
            "providers": {"codex": bool(shutil.which("codex")), "grok": bool(find_sprite_gen())}}


class Jobs:
    def __init__(self, store):
        self.store = store
        self.queue = queue.Queue()
        self.lock = threading.Lock()
        self.processes = {}
        self.cancellations = {}
        self.stopping = False
        for job in store.list("jobs"):
            if job["status"] in {"queued", "running"}:
                store.put("jobs", {**job, "status": "failed", "error": "서비스가 재시작됐습니다. 기존 결과를 확인 후 다시 실행해 주세요."})
        self.thread = threading.Thread(target=self.worker, daemon=True)
        self.thread.start()

    def submit(self, payload):
        if not isinstance(payload, dict):
            raise ValueError("작업 요청은 JSON 객체여야 합니다.")
        kind = payload.get("kind")
        if not isinstance(kind, str) or kind not in {"generate", "snap", "animate", "directions"}:
            raise ValueError("지원하지 않는 작업입니다.")
        allowed = {"kind", "prompt", "provider", "size", "referenceId"} if kind == "generate" else {"kind", "assetId", "colors", "pixelSize"}
        if kind == "animate":
            allowed = {"kind", "prompt", "provider", "size", "referenceId", "state", "frames", "fps", "loop", "accessConfirmed"}
        if kind == 'directions':
            allowed={'kind','prompt','provider','size','referenceId','directions','accessConfirmed'}
        if set(payload) - allowed:
            raise ValueError("지원하지 않는 작업 설정입니다.")
        payload = dict(payload)
        if kind in {"generate", "animate", "directions"}:
            if not find_sprite_gen():
                raise ValueError("sprite-gen을 설치하거나 SPRITE_GEN_BIN을 설정해 주세요.")
            prompt = payload.get("prompt")
            if not isinstance(prompt, str) or not 1 <= len(prompt.strip()) <= 4000:
                raise ValueError("생성할 내용을 1~4000자로 입력해 주세요.")
            if not isinstance(payload.get("provider"), str) or payload["provider"] not in {"codex", "grok"}:
                raise ValueError("생성 제공자를 선택해 주세요.")
            if type(payload.get("size")) is not int or payload["size"] not in {16, 32, 64, 128}:
                raise ValueError("지원하지 않는 크기입니다.")
            payload["prompt"] = prompt.strip()
            if payload.get("referenceId") is not None:
                if not isinstance(payload["referenceId"], str) or not payload["referenceId"]:
                    raise ValueError("참조 자산 ID가 올바르지 않습니다.")
                self.store.get("assets", payload["referenceId"])
            if kind == "animate":
                validate_animation(payload, self.store)
            if kind == 'directions':
                validate_directions(payload,self.store)
        else:
            if not find_snapper():
                raise ValueError("Pixel Snapper를 먼저 빌드해 주세요.")
            if not isinstance(payload.get("assetId"), str) or not payload["assetId"]:
                raise ValueError("자산 ID가 올바르지 않습니다.")
            self.store.get("assets", payload["assetId"])
            if type(payload.get("colors")) is not int or not 2 <= payload["colors"] <= 256:
                raise ValueError("색 수는 2~256이어야 합니다.")
            pitch = payload.get("pixelSize")
            if pitch is not None and (type(pitch) not in {int, float} or not 1 <= pitch <= 1024):
                raise ValueError("픽셀 간격은 1~1024이어야 합니다.")
        with self.lock:
            if self.stopping:
                raise ValueError("서비스를 종료하고 있습니다. 잠시 후 다시 실행해 주세요.")
            if sum(j["status"] in {"queued", "running"} for j in self.store.list("jobs")) >= 8:
                raise ValueError("대기 작업이 많습니다. 완료 후 다시 실행해 주세요.")
            job = {"id": str(uuid.uuid4()), "status": "queued", "createdAt": now(), "request": payload}
            self.store.put("jobs", job)
            self.queue.put(job["id"])
        return job

    def cancel(self, job_id):
        with self.lock:
            job = self.store.get("jobs", job_id)
            if job["status"] in {"queued", "running"}:
                job = self.store.put("jobs", {**job, "status": "cancelled", "finishedAt": now()})
                event = self.cancellations.get(job_id)
                if event:
                    event.set()
        return job

    def close(self):
        with self.lock:
            if self.stopping:
                return
            self.stopping = True
            for job in self.store.list("jobs"):
                if job["status"] in {"queued", "running"}:
                    self.store.put("jobs", {**job, "status": "cancelled", "finishedAt": now()})
            for event in self.cancellations.values():
                event.set()
            self.queue.put(None)
        self.thread.join(timeout=TERMINATION_GRACE_SECONDS + 6)

    def worker(self):
        while True:
            job_id = self.queue.get()
            try:
                if job_id is None:
                    return
                self.execute(job_id)
            finally:
                self.queue.task_done()

    def execute(self, job_id):
        try:
            with self.lock:
                job = self.store.get("jobs", job_id)
                if job["status"] == "cancelled":
                    return
                self.store.put("jobs", {**job, "status": "running"})
            payload = job["request"]
            folder = self.store.root / "jobs" / job_id
            folder.mkdir()
            deadline = time.monotonic() + JOB_TIMEOUT_SECONDS
            if payload['kind']=='directions':
                for stage,command in direction_plan(find_sprite_gen(),payload,self.store.image_path(payload['referenceId']),folder):
                    if not self.run_command(job_id,command,stage,deadline):return
                with self.lock:
                    current=self.store.get('jobs',job_id)
                    if current['status']=='cancelled':return
                    result=publish_directions(self.store,folder,payload)
                    self.store.put('jobs',{**current,**result,'status':'completed','reviewRequired':True,'finishedAt':now()})
                return
            if payload["kind"] == "animate":
                for stage, command in animation_plan(find_sprite_gen(), payload, self.store.image_path(payload["referenceId"]), folder):
                    if not self.run_command(job_id, command, stage, deadline):
                        return
                output_payload = animation_output(folder, payload)
                with self.lock:
                    current = self.store.get("jobs", job_id)
                    if current["status"] == "cancelled":
                        return
                    result = publish_animation_variants(self.store, folder, payload, output_payload)
                    self.store.put("jobs", {**current, "status": "completed", "clips": result["clips"],
                        "assetIds": [a["id"] for a in result["assets"]], "reviewRequired": True, "finishedAt": now()})
                return
            output = folder / "output.png"
            parent = payload.get("assetId") or payload.get("referenceId")
            if payload["kind"] == "generate":
                prompt = f"{payload['prompt']}\nPixel art game asset, target logical {payload['size']}x{payload['size']} pixels. Full silhouette, no text, transparent background."
                prompt_path = folder / "prompt.txt"
                prompt_path.write_text(prompt)
                command = [find_sprite_gen(), "gen", "--provider", payload["provider"], "--prompt-file", str(prompt_path),
                           "--out", str(output), "--transparent", "--keep-session", "--workdir", str(folder / "work")]
                if parent:
                    command += ["--ref", str(self.store.image_path(parent))]
                name = payload["prompt"][:60]
            else:
                command = [find_snapper(), str(self.store.image_path(parent)), str(output), str(payload["colors"])]
                if payload.get("pixelSize") is not None:
                    command += ["--pixel-size", str(payload["pixelSize"])]
                name = self.store.get("assets", parent)["name"] + " · Snap"
            if not self.run_command(job_id, command, "generate" if payload["kind"] == "generate" else "snap", deadline):
                return
            with self.lock:
                if self.store.get("jobs", job_id)["status"] == "cancelled":
                    return
                if not output.is_file():
                    raise ValueError("처리에 실패했습니다. 제공자 로그인·이용 권한 또는 입력 이미지를 확인해 주세요. 자동 재시도는 하지 않았습니다.")
                asset = self.store.add_image(output.read_bytes(), name[:120], parent, processing='pixel-snapper' if payload['kind']=='snap' else None)
                self.store.put("jobs", {**job, "status": "completed", "assetId": asset["id"], "finishedAt": now()})
        except Exception as exc:
            with self.lock:
                self.processes.pop(job_id, None)
                self.cancellations.pop(job_id, None)
                job = self.store.get("jobs", job_id)
                if job["status"] != "cancelled":
                    message = str(exc) if isinstance(exc, ValueError) else "작업을 완료하지 못했습니다. 입력과 로컬 실행 환경을 확인해 주세요."
                    self.store.put("jobs", {**job, "status": "failed", "error": message})

    def run_command(self, job_id, command, stage, deadline):
        with self.lock:
            job = self.store.get("jobs", job_id)
            if job["status"] == "cancelled":
                return False
            if time.monotonic() >= deadline:
                raise ValueError("작업 시간이 초과됐습니다. 자동 재시도하지 않았습니다.")
            self.store.put("jobs", {**job, "stage": stage})
            process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
            self.processes[job_id] = process
            cancelled = threading.Event()
            self.cancellations[job_id] = cancelled
        try:
            code = wait_for_process(process, cancelled, deadline)
        finally:
            with self.lock:
                self.processes.pop(job_id, None)
                self.cancellations.pop(job_id, None)
        with self.lock:
            if self.store.get("jobs", job_id)["status"] == "cancelled":
                return False
        if code != 0:
            raise ValueError(f"{stage} 단계에 실패했습니다. 계정 권한·입력·로컬 실행 환경을 확인해 주세요. 자동 재시도하지 않았습니다.")
        return True
