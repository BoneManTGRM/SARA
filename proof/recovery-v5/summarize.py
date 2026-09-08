"""Descriptive audit; never edits producer outputs or acceptance criteria.
python proof/recovery-v5/summarize.py RESULTS_DIRECTORY REPORT_DIRECTORY
"""
from pathlib import Path
import json,sys,collections,hashlib,statistics
source,out=map(Path,sys.argv[1:]);out.mkdir(parents=True,exist_ok=True)
r=json.loads((source/'results.json').read_text());frozen=json.loads((source/'producer-freeze.json').read_text())
assert len(r['rows'])==len(frozen['rows'])==r['distinctTasks']*9*r['repetitions']
for a,b in zip(frozen['rows'],r['rows']):
 for key,value in a.items():
  if key not in ['resolved','regression','gradeStatus']:assert b[key]==value
policies=['responsive','imperfect','unresponsive'];summary={}
def observed_bytes(row):
 total=0
 for e in row['producer']['events']:
  if e['kind'] in ['public_test','tool','model']:total+=len(e['detail']['output'].encode())
  elif e['kind']=='candidate':total+=len(e['detail']['patch'].encode())
  elif e['kind']=='output_limit':total+=e['detail']['bytes']
 return total
def repeated_failure_metrics(row):
 current=hashlib.sha256(b'').hexdigest();terminal=None;pending_start=None
 failed=set();failed_candidates=set();executed=0;retested=0
 for e in row['producer']['events']:
  if e['kind']=='action':pending_start=current if e['detail']['action']=='edit' else None
  elif e['kind']=='tool' and e['detail']['exitCode']!=0:pending_start=None
  elif e['kind']=='candidate':
   current=e['detail']['patchDigest']
   if pending_start is not None:
    terminal=(pending_start,current)
    executed+=terminal in failed
    pending_start=None
  elif e['kind']=='public_test':
   if e['detail']['exitCode']!=0:
    digest=e['detail']['patchDigest'];retested+=digest in failed_candidates;failed_candidates.add(digest)
    if terminal:failed.add(terminal)
   terminal=None
 return executed,retested
for policy in policies:
 summary[policy]={}
 for variant in 'ABC':
  rows=[x for x in r['rows'] if x['rep']==0 and x['variant']==variant and x['caseId'].endswith('--policy--'+policy)]
  assert len(rows)==r['distinctTasks']
  decisions=collections.Counter(e['detail']['action'] for x in rows for e in x['producer']['events'] if e['kind']=='decision')
  recoveries=[x for x in rows if x['resolved'] and any(e['kind']=='public_test' and e['detail']['exitCode']!=0 for e in x['producer']['events'][1:])]
  summary[policy][variant]={'resolved':sum(x['resolved'] for x in rows),'recoveries':len(recoveries),
   'recoveriesFinishedByProducer':sum(x['producer']['status']=='finished' for x in recoveries),
   'resolvedAfterExhaustion':sum(x['resolved'] and x['producer']['status']=='exhausted' for x in rows),
   'requests':sum(x['modelCalls'] for x in rows),'reservations':sum(x['producer']['modelRequests'] for x in rows),
   'tools':sum(x['producer']['toolSteps'] for x in rows),'tests':sum(x['producer']['publicTests'] for x in rows),
   'gradingProcesses':sum(2+('privateGrade' in x) for x in rows if 'freshPublic' in x),
   'retainedRegressions':sum(x['regression'] is True for x in rows),'unavailableRegressionGrades':sum(x['regression'] is None for x in rows),
   'regressionRollbacks':decisions['rollback'],'duplicateProposalsSuppressed':decisions['suppress_duplicate'],
   'equivalentTransitionsRestored':decisions['suppress_equivalent'],'scopeSuppressed':decisions['suppress_scope'],
   'repeatedEditsExecuted':sum(x['repeatedEdits'] for x in rows),
   'repeatedKnownFailedTransitionsExecuted':sum(repeated_failure_metrics(x)[0] for x in rows),
   'sameFailedCandidateRetested':sum(repeated_failure_metrics(x)[1] for x in rows),
   'failedPublicTestsAfterBaseline':sum(sum(e['kind']=='public_test' and e['detail']['exitCode']!=0 for e in x['producer']['events'][1:]) for x in rows),
   'exhausted':sum(x['producer']['status']=='exhausted' for x in rows),
   'producerOutcomes':dict(collections.Counter(x['producer']['status'] for x in rows)),
   'gradeOutcomes':dict(collections.Counter(x['gradeStatus'] for x in rows)),
   'uncertainAccounting':sum(not x['producer']['accountingComplete'] for x in rows),
   'unreconciledReservations':sum(x['producer']['unreconciledModelRequests'] for x in rows),
   'promptBytes':sum(x['promptBytes'] for x in rows),'observedOutputBytes':sum(observed_bytes(x) for x in rows),
   'partialProgress':{'meaning':'post-freeze requirement-aligned fields; not proof of intermediate correctness',
     'scenariosAssessed':sum('partialProgress' in x for x in rows),
     'scenariosEverAligned':sum(x.get('partialProgress',{}).get('alignedStates',0)>0 for x in rows),
     'alignmentLossTransitions':sum(x.get('partialProgress',{}).get('lossTransitions',0) for x in rows),
     'alignmentReuseTransitions':sum(x.get('partialProgress',{}).get('reusedAfterLoss',0) for x in rows),
     'scenariosFinallyAligned':sum(x.get('partialProgress',{}).get('finalAligned',False) for x in rows)},
   'sumCaseMedianProducerMs':sum(t['variants'][variant]['medianMs'] for t in r['table'] if t['caseId'].endswith('--policy--'+policy))}
for row in r['rows']:
 p=row['producer'];assert p['modelRequests']<=50 and p['toolSteps']<=200 and p['publicTests']<=6 and p['accountedCostUsd']==0
 assert observed_bytes(row)<=2097152
violations=[o for o in r['gate']['overhead'] if o['requests']>4 or o['tools']>4 or o['tests']>1 or o['cMs']>o['allowedMs'] or o['cPrompt']>o['allowedPrompt']]
result={'fixtureScenarios':15,'toyProgramFamilies':5,'policyConditions':45,'repetitions':3,'producerOutcomes':405,
 'independence':'Policies, repeats, related parameter variations and duplicated fault-control tasks are not independent task evidence. Do not interpret the runner distinctTasks field as 15 independent task families.',
 'policies':summary,'gate':r['gate'],'overheadViolations':violations,'frozenOutcomesUnchanged':True,
 'costs':{'physicalProviderCalls':0,'newProviderSpendUsd':0,'newHostingSpendUsd':0,'existingComputeEconomicCost':'unmeasured','actualSweBenchAttempts':0},
 'files':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in source.iterdir() if p.is_file()}}
(out/'summary.json').write_text(json.dumps(result,indent=2)+'\n')
lines=['# Complete policy comparison','','15 fixture scenarios; five toy program families. Policies and repetitions are sensitivity conditions, not independent tasks. Each cell: grading outcome; producer status; requests/tools/public tests; median producer ms.','','| Scenario | Policy | A conventional | B latest PR137 | C experiment |','|---|---|---|---|---|']
for t in r['table']:
 task,policy=t['caseId'].split('--policy--');cells=[]
 for v in 'ABC':
  x=t['variants'][v];label='resolved' if x['resolved'] else 'unresolved' if x['gradeStatus']=='completed' else 'grade '+x['gradeStatus']
  cells.append(f"{label}; {x['status']} ({x['reason']}); {x['modelRequests']}/{x['tools']}/{x['tests']}; {x['medianMs']}")
 lines.append('| '+' | '.join([task,policy]+cells)+' |')
(out/'comparison.md').write_text('\n'.join(lines)+'\n')
lines=['# Representative traces','','Selected events copied from frozen repetition 0. Complete events, digests and patches remain in results.json.','']
for task,policy,v in [('scale-batch','imperfect','B'),('scale-batch','imperfect','C'),('range-batch','responsive','C'),('price-batch','unresponsive','C'),('prefix-can-regress','unresponsive','B'),('prefix-can-regress','unresponsive','C'),('public-test-insufficient','responsive','C'),('independent-verifier-unavailable','responsive','C'),('uncertain-accounting','responsive','C')]:
 row=next(x for x in r['rows'] if x['rep']==0 and x['variant']==v and x['caseId']==task+'--policy--'+policy)
 lines+=['## '+task+' / '+policy+' / '+v,'','```json']
 for e in row['producer']['events']:
  if e['kind'] in ['public_test','failure_memory','decision','stopped'] or e['kind']=='action' and e['detail']['action'] in ['edit','test','finish']:lines.append(json.dumps(e))
 lines+=[json.dumps({k:row.get(k) for k in ['resolved','gradeStatus','freshPublic','privateGrade','patchDigest','partialProgress']}),json.dumps({k:row['producer'][k] for k in ['status','reason','modelRequests','accountingComplete','unreconciledModelRequests']}),'```','']
(out/'traces.md').write_text('\n'.join(lines)+'\n')
print(json.dumps({'policies':summary,'gate':{k:v for k,v in r['gate'].items() if k!='overhead'},'overheadViolations':violations},indent=2))
