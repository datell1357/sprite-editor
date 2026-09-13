"""Real local provider stand-ins; never contact an image provider."""
import io
import os
import signal
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from server.app import create_server
from server.jobs import Jobs
from server.store import Store


PROVIDER = '''
import base64, pathlib, signal, subprocess, sys, time
args = sys.argv
output = pathlib.Path(args[args.index('--out') + 1])
prompt = pathlib.Path(args[args.index('--prompt-file') + 1]).read_text().splitlines()[0]
if prompt == 'fail':
    sys.exit(17)
if prompt == 'invalid':
    output.write_bytes(b'not-a-png')
    sys.exit(0)
output.write_bytes(base64.b64decode('PNG_DATA'))
if prompt == 'hang':
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    child_code = "import signal,time,pathlib,sys;signal.signal(signal.SIGTERM,signal.SIG_IGN);p=pathlib.Path(sys.argv[1]);[(p.write_text(str(i)),time.sleep(.02)) for i in range(1500)]"
    child = subprocess.Popen([sys.executable, '-c', child_code, str(output.parent / 'heartbeat')])
    (output.parent / 'child.pid').write_text(str(child.pid))
    (output.parent / 'ready').write_text('ready')
    time.sleep(30)
'''


class JobLifecycleTests(unittest.TestCase):
    def setUp(self):
        import base64
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.store = Store(self.root / 'data')
        buf = io.BytesIO(); Image.new('RGBA', (4, 4), (1, 2, 3, 128)).save(buf, 'PNG')
        self.provider = self.root / 'provider'
        self.provider.write_text(f'#!{sys.executable}\n' + PROVIDER.replace('PNG_DATA', base64.b64encode(buf.getvalue()).decode()))
        self.provider.chmod(0o700)
        self.patch_bin = patch('server.jobs.find_sprite_gen', return_value=str(self.provider)); self.patch_bin.start(); self.addCleanup(self.patch_bin.stop)
        self.patch_grace = patch('server.jobs.TERMINATION_GRACE_SECONDS', 0.1); self.patch_grace.start(); self.addCleanup(self.patch_grace.stop)
        self.jobs = Jobs(self.store); self.addCleanup(self.jobs.close)

    def submit(self, prompt):
        return self.jobs.submit({'kind':'generate', 'provider':'codex', 'size':32, 'prompt':prompt})

    def wait_until(self, predicate, seconds=5):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if predicate(): return
            time.sleep(0.02)
        self.fail('Local job failed to reach expected state before deadline')

    def status(self, job):
        return self.store.get('jobs', job['id'])['status']

    def test_ignored_term_is_killed_and_next_job_runs_without_publishing_cancelled_output(self):
        blocked = self.submit('hang')
        folder = self.store.root / 'jobs' / blocked['id']
        self.wait_until(lambda: (folder / 'heartbeat').exists())
        following = self.submit('success')
        started = time.monotonic()
        self.assertEqual(self.jobs.cancel(blocked['id'])['status'], 'cancelled')
        self.assertLess(time.monotonic() - started, 0.5)
        self.wait_until(lambda: self.status(following) == 'completed')
        self.assertEqual(self.status(blocked), 'cancelled')
        self.assertTrue((folder / 'output.png').exists())
        self.assertEqual(len(self.store.list('assets')), 1)
        self.assertEqual(self.store.list('assets')[0]['name'], 'success')
        heartbeat = (folder / 'heartbeat').read_text()
        time.sleep(0.15)
        self.assertEqual((folder / 'heartbeat').read_text(), heartbeat)

    def test_queued_cancel_never_starts_provider(self):
        blocked = self.submit('hang')
        self.wait_until(lambda: (self.store.root / 'jobs' / blocked['id'] / 'ready').exists())
        queued = self.submit('success')
        self.jobs.cancel(queued['id']); self.jobs.cancel(blocked['id'])
        self.wait_until(lambda: self.jobs.queue.unfinished_tasks == 0)
        self.assertFalse((self.store.root / 'jobs' / queued['id']).exists())
        self.assertEqual(self.store.list('assets'), [])

    def test_timeout_preserves_failure_and_releases_worker(self):
        with patch('server.jobs.JOB_TIMEOUT_SECONDS', 0.3):
            blocked = self.submit('hang')
            self.wait_until(lambda: self.status(blocked) == 'failed')
        self.assertIn('초과', self.store.get('jobs', blocked['id'])['error'])
        next_job = self.submit('success')
        self.wait_until(lambda: self.status(next_job) == 'completed')
        self.assertEqual(len(self.store.list('assets')), 1)

    def test_exit_error_and_invalid_png_do_not_publish_and_worker_survives(self):
        for prompt in ('fail', 'invalid'):
            job = self.submit(prompt)
            self.wait_until(lambda: self.status(job) == 'failed')
        self.assertEqual(self.store.list('assets'), [])
        good = self.submit('success'); self.wait_until(lambda: self.status(good) == 'completed')
        self.assertEqual(self.jobs.cancel(good['id'])['status'], 'completed')

    def test_spawn_failure_is_safe_and_does_not_kill_worker(self):
        with patch('server.jobs.subprocess.Popen', side_effect=OSError('private diagnostic')):
            job = self.submit('success')
            self.wait_until(lambda: self.status(job) == 'failed')
        self.assertNotIn('private diagnostic', self.store.get('jobs',job['id'])['error'])
        good = self.submit('success'); self.wait_until(lambda: self.status(good) == 'completed')

    def test_shutdown_cancels_running_and_queued_jobs(self):
        job = self.submit('hang')
        self.wait_until(lambda: (self.store.root / 'jobs' / job['id'] / 'ready').exists())
        queued = self.submit('success')
        self.jobs.close()
        self.assertFalse(self.jobs.thread.is_alive())
        self.assertEqual(self.status(job), 'cancelled'); self.assertEqual(self.status(queued), 'cancelled')
        with self.assertRaises(ValueError): self.submit('success')

    def test_request_normalization_prevents_paid_job_with_blank_asset_name(self):
        job = self.submit(' ' * 80 + 'success' + '  ')
        self.assertEqual(job['request']['prompt'], 'success')
        self.wait_until(lambda: self.status(job) == 'completed')
        for extra in ({'size':32.0}, {'referenceId':[]}, {'apiKey':'should-not-be-stored'}, {'provider':[]}):
            with self.assertRaises(ValueError):
                self.jobs.submit({'kind':'generate','provider':'codex','size':32,'prompt':'success',**extra})


class ServerStartupTests(unittest.TestCase):
    def test_port_conflict_does_not_touch_live_job_state(self):
        with patch('server.app.ThreadingHTTPServer',side_effect=OSError('address in use')), patch('server.app.Jobs') as jobs, patch('server.app.Store') as store:
            with self.assertRaises(OSError): create_server(Path('/unused'))
            jobs.assert_not_called(); store.assert_not_called()
