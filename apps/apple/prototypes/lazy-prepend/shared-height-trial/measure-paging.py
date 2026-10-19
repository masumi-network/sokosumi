#!/usr/bin/env python3
"""Replay the six recorded paging runs sequentially; no new investigation controls."""
import json, os, subprocess, statistics, sys
from pathlib import Path
before=Path(sys.argv[1]).resolve()
after=Path(sys.argv[2]).resolve()
root=Path(sys.argv[3]).resolve()
assert not root.exists(), "Use a fresh result directory"
root.mkdir(parents=True)
apps={"before":before,"after":after}
results=[]
for cycle, order in enumerate([['before','after'],['after','before'],['before','after']],1):
 for variant in order:
  name=f'{variant}-{cycle}'
  env=dict(os.environ,HITCH_MODE='paging',HITCH_SCRIPTED_PAGES='5',HITCH_COUNT='600',HITCH_INITIAL='100',HITCH_SETTLE='3',HITCH_PAGE='100',HITCH_LATENCY_MS='150')
  with (root/(name+'.log')).open('w') as out:
   subprocess.run([str(apps[variant]/'Contents/MacOS/Sokosumi')],env=env,stdout=out,stderr=subprocess.STDOUT,timeout=90,check=True)
  run=json.loads(next(line for line in (root/(name+'.log')).read_text().splitlines() if line.startswith('{')))
  (root/(name+'.json')).write_text(json.dumps(run,indent=2)+'\n')
  assert run['requests']==6 and run['messages_end']==600,run
  assert [p['messages'] for p in run['publication_windows']]==[200,300,400,500,600],run
  if results:assert run['input_fingerprint_sha256']==results[0]['result']['input_fingerprint_sha256']
  results.append(dict(cycle=cycle,variant=variant,result=run))
  gaps=[p['max_gap_ms'] for p in run['publication_windows']]
  print(json.dumps(dict(run=name,gaps=gaps,median=statistics.median(gaps),fallback=run['fallback_measurements'],shared=run['shared_measurements'])),flush=True)
(root/'paging-results.json').write_text(json.dumps(results,indent=2)+'\n')
for variant in ['before','after']:
 gaps=[p['max_gap_ms'] for run in results if run['variant']==variant for p in run['result']['publication_windows']]
 print(variant,'median',statistics.median(gaps),'worst',max(gaps),'above33.4',sum(g>33.4 for g in gaps),flush=True)
