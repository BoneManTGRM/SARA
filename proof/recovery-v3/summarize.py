"""Descriptive audit only: python proof/recovery-v3/summarize.py RESULTS OUTPUT"""
from pathlib import Path
import json,sys,collections,hashlib
source,out=map(Path,sys.argv[1:]);out.mkdir(parents=True,exist_ok=True)
r=json.loads((source/'results.json').read_text());frozen=json.loads((source/'producer-freeze.json').read_text())
assert len(r['rows'])==len(frozen['rows'])==351
for a,b in zip(frozen['rows'],r['rows']):
 for key,value in a.items():
  if key not in ['resolved','regression','gradeStatus']:assert b[key]==value
policies=['responsive','imperfect','unresponsive'];summary={}
for policy in policies:
 summary[policy]={}
 for variant in 'ABC':
  rows=[x for x in r['rows'] if x['rep']==0 and x['variant']==variant and x['caseId'].endswith('--policy--'+policy)]
  assert len(rows)==13
  decisions=collections.Counter(e['detail']['action'] for x in rows for e in x['producer']['events'] if e['kind']=='decision')
  summary[policy][variant]={'resolved':sum(x['resolved'] for x in rows),'recoveries':sum(x['resolved'] and any(e['kind']=='public_test' and e['detail']['exitCode']!=0 for e in x['producer']['events'][1:]) for x in rows),
   'requests':sum(x['modelCalls'] for x in rows),'reservations':sum(x['producer']['modelRequests'] for x in rows),'tools':sum(x['producer']['toolSteps'] for x in rows),'tests':sum(x['producer']['publicTests'] for x in rows),
   'gradingProcesses':sum(2+('privateGrade' in x) for x in rows if 'freshPublic' in x),'retainedRegressions':sum(x['regression'] is True for x in rows),'unavailableRegressionGrades':sum(x['regression'] is None for x in rows),
   'rollbacks':decisions['rollback'],'duplicateProposalsSuppressed':decisions['suppress_duplicate'],'scopeSuppressed':decisions['suppress_scope'],'repeatedEditsExecuted':sum(x['repeatedEdits'] for x in rows),
   'exhausted':sum(x['producer']['status']=='exhausted' for x in rows),'earlyStops':sum(x['producer']['reason']=='PRODUCER_REPEATED_FAILED_EDIT' for x in rows),'gradeOutcomes':dict(collections.Counter(x['gradeStatus'] for x in rows)),
   'promptBytes':sum(x['promptBytes'] for x in rows)}
 for row in r['rows']:
  p=row['producer'];assert p['modelRequests']<=50 and p['toolSteps']<=200 and p['publicTests']<=6 and p['accountedCostUsd']==0
result={'distinctTasks':13,'policyCases':39,'repetitions':3,'producerOutcomes':351,'policies':summary,'gate':r['gate'],'files':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in source.iterdir() if p.is_file()}}
(out/'summary.json').write_text(json.dumps(result,indent=2)+'\n')
lines=['# Complete policy comparison','','13 tasks; three response policies are sensitivity conditions, not independent tasks. Each cell: outcome; requests/tools/public tests; median producer ms.','','| Task | Policy | A conventional | B latest PR137 | C experiment |','|---|---|---|---|---|']
for t in r['table']:
 task,policy=t['caseId'].split('--policy--');cells=[]
 for v in 'ABC':
  x=t['variants'][v];label='resolved' if x['resolved'] else x['reason'] if x['status']!='finished' else 'unresolved' if x['gradeStatus']=='completed' else 'grade '+x['gradeStatus']
  cells.append(f"{label}; {x['modelRequests']}/{x['tools']}/{x['tests']}; {x['medianMs']}")
 lines.append('| '+' | '.join([task,policy]+cells)+' |')
(out/'comparison.md').write_text('\n'.join(lines)+'\n')
lines=['# Representative traces','','Selected events are copied from frozen repetition 0. Complete events and patches remain in results.json.','']
for task,policy,v in [('intercept-invariant','imperfect','B'),('intercept-invariant','imperfect','C'),('intercept-invariant','unresponsive','B'),('intercept-invariant','unresponsive','C'),('upper-bound-invariant','responsive','C'),('uncertain-dispatch','responsive','C')]:
 row=next(x for x in r['rows'] if x['rep']==0 and x['variant']==v and x['caseId']==task+'--policy--'+policy)
 lines+=['## '+task+' / '+policy+' / '+v,'','```json']
 for e in row['producer']['events']:
  if e['kind'] in ['public_test','failure_memory','decision','stopped'] or e['kind']=='action' and e['detail']['action'] in ['edit','test','finish']:lines.append(json.dumps(e))
 lines+=[json.dumps({k:row.get(k) for k in ['resolved','gradeStatus','freshPublic','privateGrade','patchDigest']}),json.dumps({k:row['producer'][k] for k in ['status','reason','modelRequests','accountingComplete','unreconciledModelRequests']}),'```','']
(out/'traces.md').write_text('\n'.join(lines))
print(json.dumps({'policies':summary,'gate':{k:v for k,v in r['gate'].items() if k!='overhead'}},indent=2))
