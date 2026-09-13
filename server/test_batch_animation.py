"""Atomic batch admission and independent execution, with no remote provider calls."""
import io
import json
import sqlite3
import threading
import time
import unittest
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from unittest.mock import patch

from PIL import Image

from server import test_animation
from server.app import make_handler


class BatchAnimationTests(unittest.TestCase):
    setUp = test_animation.AnimationTests.setUp
    wait = test_animation.AnimationTests.wait

    def request(self, **overrides):
        return dict(anchors=[{'direction': d, 'assetId': self.reference['id']} for d in ('down', 'up')],
                    prompt='walk naturally', size=32, state='walk', frames=4, fps=8,
                    loop=True, accessConfirmed=True) | overrides

    def test_all_references_and_settings_validate_before_any_admission(self):
        invalid = [{'direction':'down','assetId':self.reference['id']}, {'direction':'up','assetId':'missing'}]
        with self.assertRaises(KeyError): self.jobs.submit_batch(self.request(anchors=invalid))
        for override in ({'anchors':[]}, {'anchors':[{'direction':'down','assetId':None}]},
                         {'anchors':[{'direction':'down','assetId':self.reference['id']}]*2},
                         {'anchors':[{'direction':'side','assetId':self.reference['id']}]},
                         {'accessConfirmed':False}, {'frames':True}, {'apiKey':'not-allowed'}):
            with self.assertRaises(ValueError): self.jobs.submit_batch(self.request(**override))
        self.assertEqual(self.store.list('jobs'), [])
        self.assertEqual(self.jobs.queue.unfinished_tasks, 0)

    def test_batch_capacity_rejects_all_without_losing_existing_jobs(self):
        with patch.object(self.jobs, 'execute'):
            existing = self.jobs.submit_batch(self.request(anchors=[{'direction':d,'assetId':self.reference['id']} for d in ('down','up','left','right','down45_left','up45_left','down45_right')]))
            with self.assertRaises(ValueError): self.jobs.submit_batch(self.request())
            self.assertEqual({j['id'] for j in self.store.list('jobs')}, {j['id'] for j in existing})
            deadline=time.monotonic()+2
            while self.jobs.queue.unfinished_tasks and time.monotonic()<deadline: time.sleep(.01)
            self.assertEqual(self.jobs.queue.unfinished_tasks, 0)

    def test_database_error_rolls_back_whole_batch_before_queueing(self):
        with patch('server.jobs.uuid.uuid4', return_value='collision'):
            with self.assertRaises(sqlite3.IntegrityError): self.jobs.submit_batch(self.request())
        self.assertEqual(self.store.list('jobs'), [])
        self.assertEqual(self.jobs.queue.unfinished_tasks, 0)

    def test_http_batch_returns_registered_jobs_and_both_complete(self):
        server=ThreadingHTTPServer(('127.0.0.1',0),make_handler(self.store,self.jobs))
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        connection=HTTPConnection('127.0.0.1',server.server_port,timeout=3)
        try:
            connection.request('POST','/api/jobs/batch-animation',json.dumps(self.request()),
                               {'Content-Type':'application/json','Origin':'http://localhost:5186'})
            response=connection.getresponse();body=json.loads(response.read())
            self.assertEqual(response.status,202,body)
            self.assertEqual(len(body['jobs']),2)
            for job in body['jobs']:
                result=self.wait(job)
                self.assertEqual(result['status'],'completed',result.get('error'))
                self.assertEqual(result['batchId'],job['batchId'])
                self.assertEqual(result['clips'][0]['name'],job['direction']+'_walk')
        finally:
            connection.close();server.shutdown();thread.join(timeout=3);server.server_close()

    def test_failed_direction_does_not_stop_next_direction_or_publish_its_assets(self):
        # Make the local stand-in fail only for a red reference, not by changing
        # the admitted prompt or replacing the worker's execution behavior.
        provider=self.root/'provider'
        provider.write_text(provider.read_text().replace("if action.startswith('fail generate'):",
            "if Image.open(run/'base-source.png').getpixel((0,0))[0] == 255:"))
        buf=io.BytesIO();Image.new('RGBA',(32,32),(255,0,0,255)).save(buf,'PNG')
        bad=self.store.add_image(buf.getvalue(),'failing reference')
        jobs=self.jobs.submit_batch(self.request(anchors=[{'direction':'down','assetId':bad['id']}, {'direction':'up','assetId':self.reference['id']}]))
        self.assertEqual(len({j['batchId'] for j in jobs}), 1)
        self.assertEqual([j['direction'] for j in jobs], ['down','up'])
        self.assertEqual([j['request']['referenceId'] for j in jobs], [bad['id'], self.reference['id']])
        failed,completed=[self.wait(j) for j in jobs]
        self.assertEqual(failed['status'], 'failed')
        self.assertNotIn('clips', failed)
        self.assertEqual(completed['status'], 'completed', completed.get('error'))
        self.assertEqual([c['name'] for c in completed['clips']], ['up_walk', 'up_walk'])
        self.assertEqual([c['variant'] for c in completed['clips']], ['pixel-unfake', 'plain'])
        self.assertEqual(len(self.store.list('assets')), 10)
        self.assertEqual(self.jobs.cancel(completed['id'])['status'], 'completed')
