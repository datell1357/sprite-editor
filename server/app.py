"""Loopback-only API for the local editor; no arbitrary paths or remote URLs."""
import json
import os
import re
import signal
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from .jobs import Jobs, capabilities
from .store import Store
from .atlas import import_atlas
from .run_import import import_run


def make_handler(store, jobs):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def respond(self, status, payload, content_type="application/json", filename=None):
            data = json.dumps(payload, ensure_ascii=False).encode() if content_type == "application/json" else payload
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Cache-Control", "no-store")
            if filename:
                self.send_header('Content-Disposition',f'attachment; filename="{filename}"')
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            try:
                path = urlsplit(self.path).path
                if path == "/api/status":
                    return self.respond(200, capabilities())
                if path in {"/api/assets", "/api/jobs"}:
                    return self.respond(200, store.list(path.split("/")[-1]))
                match = re.fullmatch(r"/api/assets/([a-f0-9-]{36})/image", path)
                if match:
                    return self.respond(200, store.image_path(match[1]).read_bytes(), "image/png")
                match=re.fullmatch(r'/api/imports/([a-f0-9-]{36})/archive',path)
                if match:
                    job=store.get('jobs',match[1])
                    if job.get('request',{}).get('kind')!='import-run': raise KeyError('archive')
                    return self.respond(200,(store.root/'imports'/f'{match[1]}.zip').read_bytes(),'application/zip','sprite-gen-run.zip')
                self.respond(404, {"error": "경로를 찾을 수 없습니다."})
            except (KeyError, FileNotFoundError):
                self.respond(404, {"error": "자산을 찾을 수 없습니다."})

        def do_POST(self):
            try:
                origin = self.headers.get("Origin")
                allowed = {"http://127.0.0.1:5186", "http://localhost:5186", "http://127.0.0.1:4186", "http://localhost:4186"}
                if origin and origin not in allowed:
                    return self.respond(403, {"error": "허용하지 않는 요청 출처입니다."})
                if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                    return self.respond(415, {"error": "JSON 요청이 필요합니다."})
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 18 * 1024 * 1024:
                    return self.respond(413, {"error": "요청 크기가 너무 큽니다."})
                payload = json.loads(self.rfile.read(length))
                if not isinstance(payload, dict):
                    raise ValueError("JSON 객체가 필요합니다.")
                if self.path == "/api/assets":
                    return self.respond(201, store.import_data_url(payload))
                if self.path == "/api/import-atlas":
                    return self.respond(201, import_atlas(store, payload))
                if self.path == '/api/import-run':
                    return self.respond(201,import_run(store,payload))
                if self.path == "/api/jobs":
                    return self.respond(202, jobs.submit(payload))
                match = re.fullmatch(r"/api/jobs/([a-f0-9-]{36})/cancel", self.path)
                if match:
                    return self.respond(200, jobs.cancel(match[1]))
                self.respond(404, {"error": "경로를 찾을 수 없습니다."})
            except KeyError:
                self.respond(404, {"error": "참조 자산 또는 작업을 찾을 수 없습니다."})
            except (ValueError, TypeError) as exc:
                self.respond(400, {"error": str(exc)})
            except Exception:
                self.respond(500, {"error": "로컬 저장에 실패했습니다."})
    return Handler


def create_server(root, port=8796):
    # Bind first: a second launch must not run restart recovery against the
    # live server's jobs before discovering that the port is already occupied.
    server = ThreadingHTTPServer(("127.0.0.1", port), BaseHTTPRequestHandler)
    try:
        store = Store(root)
        jobs = Jobs(store)
        server.RequestHandlerClass = make_handler(store, jobs)
        return server, jobs
    except Exception:
        server.server_close()
        raise


def main():
    root = Path(os.environ.get("SPRITE_EDITOR_DATA", ".data")).resolve()
    server, jobs = create_server(root)
    def stop(_signum, _frame):
        raise SystemExit(0)
    signal.signal(signal.SIGTERM, stop)
    print("Sprite Editor API: http://127.0.0.1:8796", flush=True)
    try:
        server.serve_forever()
    finally:
        jobs.close()
        server.server_close()


if __name__ == "__main__":
    main()
