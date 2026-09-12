"""One local worker. Never run client-supplied commands or overwrite input assets."""
from __future__ import annotations

import os
import queue
import shutil
import signal
import subprocess
import threading
import uuid
from pathlib import Path

from .store import now


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
        for job in store.list("jobs"):
            if job["status"] in {"queued", "running"}:
                store.put("jobs", {**job, "status": "failed", "error": "서비스가 재시작됐습니다. 기존 결과를 확인 후 다시 실행해 주세요."})
        threading.Thread(target=self.worker, daemon=True).start()

    def submit(self, payload):
        kind = payload.get("kind")
        if kind not in {"generate", "snap"}:
            raise ValueError("지원하지 않는 작업입니다.")
        if kind == "generate":
            if not find_sprite_gen():
                raise ValueError("sprite-gen을 설치하거나 SPRITE_GEN_BIN을 설정해 주세요.")
            prompt = payload.get("prompt")
            if not isinstance(prompt, str) or not 1 <= len(prompt.strip()) <= 4000:
                raise ValueError("생성할 내용을 1~4000자로 입력해 주세요.")
            if payload.get("provider") not in {"codex", "grok"}:
                raise ValueError("생성 제공자를 선택해 주세요.")
            if payload.get("size") not in {16, 32, 64, 128}:
                raise ValueError("지원하지 않는 크기입니다.")
            if payload.get("referenceId"):
                self.store.get("assets", payload["referenceId"])
        else:
            if not find_snapper():
                raise ValueError("Pixel Snapper를 먼저 빌드해 주세요.")
            self.store.get("assets", payload.get("assetId"))
            if type(payload.get("colors")) is not int or not 2 <= payload["colors"] <= 256:
                raise ValueError("색 수는 2~256이어야 합니다.")
            pitch = payload.get("pixelSize")
            if pitch is not None and (type(pitch) not in {int, float} or not 1 <= pitch <= 1024):
                raise ValueError("픽셀 간격은 1~1024이어야 합니다.")
        with self.lock:
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
                job = self.store.put("jobs", {**job, "status": "cancelled"})
                process = self.processes.get(job_id)
                if process:
                    self.terminate(process)
        return job

    @staticmethod
    def terminate(process):
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass

    def worker(self):
        while True:
            job_id = self.queue.get()
            try:
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
            with self.lock:
                if self.store.get("jobs", job_id)["status"] == "cancelled":
                    return
                process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
                self.processes[job_id] = process
            try:
                code = process.wait(timeout=1200)
            except subprocess.TimeoutExpired:
                self.terminate(process)
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
                raise ValueError("작업 시간이 초과됐습니다. 제공자 상태와 기존 결과를 확인해 주세요.")
            with self.lock:
                self.processes.pop(job_id, None)
                if self.store.get("jobs", job_id)["status"] == "cancelled":
                    return
                if code != 0 or not output.is_file():
                    raise ValueError("처리에 실패했습니다. 제공자 로그인·이용 권한 또는 입력 이미지를 확인해 주세요. 자동 재시도는 하지 않았습니다.")
                asset = self.store.add_image(output.read_bytes(), name[:120], parent)
                self.store.put("jobs", {**job, "status": "completed", "assetId": asset["id"], "finishedAt": now()})
        except Exception as exc:
            with self.lock:
                self.processes.pop(job_id, None)
                job = self.store.get("jobs", job_id)
                if job["status"] != "cancelled":
                    message = str(exc) if isinstance(exc, ValueError) else "작업을 완료하지 못했습니다. 입력과 로컬 실행 환경을 확인해 주세요."
                    self.store.put("jobs", {**job, "status": "failed", "error": message})
