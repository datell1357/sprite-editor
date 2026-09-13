import base64
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from server.directions import FACING,direction_plan,publish_directions,validate_directions
from server.jobs import Jobs
from server.store import Store


class DirectionTests(unittest.TestCase):
    def setUp(self):
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup);self.root=Path(temp.name)
        self.store=Store(self.root/'data');buf=io.BytesIO();Image.new('RGBA',(32,32),(30,80,20,255)).save(buf,'PNG')
        self.reference=self.store.add_image(buf.getvalue(),'reference')
        self.payload={'kind':'directions','provider':'codex','prompt':'pixel hero','size':32,'referenceId':self.reference['id'],'directions':['down','up45_left'],'accessConfirmed':True}
        (self.root/'run').mkdir()

    def output(self,extra=False,frames=1,qa=True,blank=False):
        directions=self.payload['directions']+(['right'] if extra else [])
        sheet=Image.new('RGBA',(32*frames,32*len(directions)),(20,100,40,0 if blank else 128));sheet.save(self.root/'run/sprite-sheet-alpha.png')
        rows={d+'_idle':[{'x':i*32,'y':n*32,'w':32,'h':32} for i in range(frames)] for n,d in enumerate(directions)}
        manifest={'frame_layout':{'sheetWidth':32*frames,'sheetHeight':32*len(directions),'cellWidth':32,'cellHeight':32,'rows':rows},
                  'animation':{'rows':{name:{'frames':frames,'fps':1,'loop':False} for name in rows}}}
        (self.root/'run/manifest.json').write_text(json.dumps(manifest));(self.root/'qa.json').write_text(json.dumps({'ok':qa}))

    def test_all_eight_directions_are_explicit_single_frame_anchors_without_mirroring(self):
        payload={**self.payload,'directions':list(FACING)}
        plan=direction_plan('sprite-gen',payload,self.store.image_path(self.reference['id']),self.root)
        recipe=json.loads((self.root/'recipe.json').read_text())
        self.assertEqual(len(recipe['states']),8);self.assertNotIn('mirror',recipe['directions'])
        for direction in FACING:
            state=recipe['states'][direction+'_idle'];self.assertEqual(state['frames'],1);self.assertIn(FACING[direction],state['action'])
        self.assertEqual([stage for stage,_ in plan],['access','prepare','generate','extract','compose','inspect'])
        self.assertIn('--provider',plan[2][1]);self.assertEqual(plan[2][1][-2:],['--concurrency','1'])

    def test_publishes_requested_directions_and_keeps_reference_relationship(self):
        self.output();result=publish_directions(self.store,self.root,self.payload)
        self.assertEqual([a['direction'] for a in result['directionAnchors']],self.payload['directions'])
        for anchor in result['directionAnchors']:
            asset=self.store.get('assets',anchor['assetId']);self.assertEqual(asset['parentId'],self.reference['id'])
        self.assertEqual(len(self.store.list('assets')),3)

    def test_missing_wrong_or_multi_frame_directions_never_publish(self):
        for config in ({'extra':True},{'frames':2},{'qa':False},{'blank':True}):
            self.output(**config)
            with self.assertRaises(ValueError):publish_directions(self.store,self.root,self.payload)
        self.assertEqual(len(self.store.list('assets')),1)

    def test_unconfirmed_unknown_or_duplicate_direction_requests_are_rejected(self):
        for values in ({'directions':[]},{'directions':['down','down']},{'directions':['../escape']},{'directions':[{}]},{'accessConfirmed':False},{'provider':'grok'},{'referenceId':None}):
            with self.assertRaises(ValueError):validate_directions(self.payload|values,self.store)

    def test_job_runs_complete_plan_before_publishing(self):
        import shutil,time
        self.output();jobs=Jobs(self.store);self.addCleanup(jobs.close)
        stages=[];deadlines=[]
        def runner(job_id,command,stage,deadline):
            stages.append(stage);deadlines.append(deadline)
            folder=self.store.root/'jobs'/job_id
            if stage=='compose':shutil.copytree(self.root/'run',folder/'run')
            if stage=='inspect':shutil.copy2(self.root/'qa.json',folder/'qa.json')
            return True
        with patch('server.jobs.find_sprite_gen',return_value='fake'),patch.object(jobs,'run_command',side_effect=runner):
            job=jobs.submit(self.payload);until=time.monotonic()+3
            while time.monotonic()<until:
                result=self.store.get('jobs',job['id'])
                if result['status'] in ('completed','failed'):break
                time.sleep(.01)
            self.assertEqual(result['status'],'completed',result.get('error'))
        self.assertEqual(len(stages),6);self.assertEqual(len(set(deadlines)),1);self.assertTrue(result['reviewRequired'])
