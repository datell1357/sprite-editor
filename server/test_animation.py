import io
import json
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from server.jobs import Jobs, wait_for_process
from server.store import Store

PIPELINE = '''
import json,pathlib,shutil,sys
from PIL import Image
args=sys.argv; verb=args[1]
def value(flag): return args[args.index(flag)+1]
if verb=='workflow':
    assert value('--motion-method')=='gpt-rows' and value('--confirmed-access')=='codex'
    sys.exit(0)
run=pathlib.Path(value('--out-dir') if verb=='prepare' else value('--run-dir'))
if verb=='prepare':
    run.mkdir(); recipe=json.loads(pathlib.Path(value('--request')).read_text())
    recipe['size']=int(value('--cell-size')); (run/'sprite-request.json').write_text(json.dumps(recipe))
    shutil.copy2(value('--base-image'),run/'base-source.png')
request=json.loads((run/'sprite-request.json').read_text())
state,row=next(iter(request['states'].items())); action=row['action']
with (run/'trace.txt').open('a') as file: file.write(verb+'\\n')
if verb=='gen-set':
    assert value('--provider')=='codex' and value('--concurrency')=='1'
    if action.startswith('fail generate'): sys.exit(9)
    (run/'generated').write_text('yes')
if verb=='extract':
    assert (run/'generated').exists(); (run/'extracted').write_text('yes')
    frames_dir=run/'frames'/state; frames_dir.mkdir(parents=True)
    plain=[]
    for i in range(row['frames']):
        path=frames_dir/f'frame-{i}.plain.png'
        Image.new('RGBA',(request['size'],request['size']),(20+i,100,200,128)).save(path)
        plain.append(str(path.relative_to(run)))
    if action.startswith('missing plain'): plain.pop()
    if action.startswith('outside plain'): plain[0]='../../outside.png'
    (run/'frames/frames-manifest.json').write_text(json.dumps({'ok':True,'rows':[{'state':state,'plain_files':plain}]}))
if verb=='compose-atlas':
    assert (run/'extracted').exists()
    count=row['frames']+(1 if action.startswith('wrong count') else 0); size=request['size']
    sheet=Image.new('RGBA',(size*count,size))
    for i in range(count): sheet.paste((i*15,100,200,128),(i*size,0,(i+1)*size,size))
    sheet.save(run/'sprite-sheet-alpha.png')
    rects=[dict(x=i*size,y=0,w=size,h=size) for i in range(count)]
    manifest={'characterId':'test','frame_layout':dict(sheetWidth=size*count,sheetHeight=size,cellWidth=size,cellHeight=size,rows={state:rects}),
        'animation':{'rows':{state:dict(frames=count,fps=row['fps'],loop=row['loop'],durations_ms=[1000/row['fps']]*count)}}}
    (run/'manifest.json').write_text(json.dumps(manifest))
if verb=='inspect':
    pathlib.Path(value('--report')).write_text(json.dumps({'ok':not action.startswith('bad qa')}))
'''


class AnimationTests(unittest.TestCase):
    def setUp(self):
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup)
        self.root=Path(temp.name);self.store=Store(self.root/'data')
        image=Image.new('RGBA',(32,32),(20,50,80,255));buf=io.BytesIO();image.save(buf,'PNG')
        self.reference=self.store.add_image(buf.getvalue(),'reference')
        provider=self.root/'provider';provider.write_text(f'#!{sys.executable}\n'+PIPELINE);provider.chmod(0o700)
        patcher=patch('server.jobs.find_sprite_gen',return_value=str(provider));patcher.start();self.addCleanup(patcher.stop)
        grace=patch('server.jobs.TERMINATION_GRACE_SECONDS',.1);grace.start();self.addCleanup(grace.stop)
        self.jobs=Jobs(self.store);self.addCleanup(self.jobs.close)

    def request(self, **overrides):
        return dict(kind='animate',prompt='walk naturally',provider='codex',size=32,referenceId=self.reference['id'],state='walk',frames=4,fps=8,loop=True,accessConfirmed=True) | overrides

    def wait(self,job):
        deadline=time.monotonic()+8
        while time.monotonic()<deadline:
            result=self.store.get('jobs',job['id'])
            if result['status'] in {'completed','failed','cancelled'}: return result
            time.sleep(.02)
        self.fail('Animation test timed out')

    def test_full_pipeline_uses_one_deadline_and_preserves_requested_frames(self):
        with patch('server.jobs.wait_for_process',wraps=wait_for_process) as waits:
            result=self.wait(self.jobs.submit(self.request()))
        self.assertEqual(result['status'],'completed',result.get('error'))
        self.assertEqual(waits.call_count,6)
        self.assertEqual(len({call.args[2] for call in waits.call_args_list}),1)
        clip=result['clips'][0]
        self.assertEqual((clip['name'],len(clip['frames']),clip['fps'],clip['loop']),('walk',4,8,True))
        self.assertEqual([f['durationMs'] for f in clip['frames']],[125]*4)
        self.assertTrue(result['reviewRequired'])
        self.assertEqual(len(self.store.list('assets')),9)
        self.assertEqual([c['variant'] for c in result['clips']],['pixel-unfake','plain'])
        for pixel,plain in zip(result['clips'][0]['frames'],result['clips'][1]['frames']):
            self.assertEqual(self.store.get('assets',pixel['assetId'])['parentId'],plain['assetId'])
            self.assertEqual(pixel['durationMs'],plain['durationMs'])
        for frame in clip['frames']:
            with Image.open(self.store.image_path(frame['assetId'])) as image:
                self.assertEqual(image.size,(32,32));self.assertEqual(image.getpixel((0,0))[3],128)

    def test_stage_failure_stops_without_partial_asset_publication(self):
        result=self.wait(self.jobs.submit(self.request(prompt='fail generate')))
        self.assertEqual(result['status'],'failed')
        trace=(self.store.root/'jobs'/result['id']/'run/trace.txt').read_text().splitlines()
        self.assertEqual(trace,['prepare','gen-set'])
        self.assertEqual(len(self.store.list('assets')),1)

    def test_wrong_count_or_false_qa_report_never_becomes_a_clip(self):
        for prompt in ('wrong count','bad qa','missing plain','outside plain'):
            result=self.wait(self.jobs.submit(self.request(prompt=prompt)))
            self.assertEqual(result['status'],'failed')
            self.assertNotIn('clips',result)
        self.assertEqual(len(self.store.list('assets')),1)

    def test_cancellation_between_stages_prevents_generation(self):
        def cancel_after_prepare(process,event,deadline):
            result=wait_for_process(process,event,deadline)
            job=self.store.list('jobs')[0]
            if job.get('stage')=='prepare':self.jobs.cancel(job['id'])
            return result
        with patch('server.jobs.wait_for_process',side_effect=cancel_after_prepare):
            result=self.wait(self.jobs.submit(self.request()))
        self.assertEqual(result['status'],'cancelled')
        self.assertEqual((self.store.root/'jobs'/result['id']/'run/trace.txt').read_text().splitlines(),['prepare'])
        self.assertEqual(len(self.store.list('assets')),1)

    def test_permission_reference_and_numeric_contract_are_required(self):
        for override in ({'accessConfirmed':False},{'referenceId':None},{'frames':1},{'frames':4.0},{'fps':0},{'loop':'true'},{'state':'../../escape'},{'provider':'grok'}):
            with self.assertRaises(ValueError): self.jobs.submit(self.request(**override))
        self.assertEqual(self.store.list('jobs'),[])
