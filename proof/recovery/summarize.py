"""Post-evaluation descriptive audit; does not edit fixtures, outcomes or gate.
Usage: python proof/recovery/summarize.py EVALUATION_DIRECTORY OUTPUT_DIRECTORY
"""
import collections, hashlib, json, pathlib, sys
source, output = map(pathlib.Path, sys.argv[1:])
output.mkdir(parents=True, exist_ok=True)
r = json.loads((source / 'results.json').read_text())
frozen = json.loads((source / 'producer-freeze.json').read_text())
assert len(r['rows']) == len(frozen['rows']) == 117
for before, after in zip(frozen['rows'], r['rows']):
    for key, value in before.items():
        if key not in {'gradeStatus', 'resolved', 'regression'}:
            assert after[key] == value, (key, after['caseId'])
aggregate = {}
for variant in 'ABC':
    rows = [x for x in r['rows'] if x['rep'] == 0 and x['variant'] == variant]
    # The frozen harness's `recovery` shorthand counts >1 failed tests, which
    # misses a repair regression after a green baseline. This separate report
    # counts a resolved task with ANY failed post-baseline public test instead.
    recovery = [x['caseId'] for x in rows if x['resolved'] and any(
        e['kind'] == 'public_test' and e['detail']['exitCode'] != 0
        for e in x['producer']['events'][1:])]
    decisions = collections.Counter(e['detail']['action'] for x in rows
        for e in x['producer']['events'] if e['kind'] == 'decision')
    aggregate[variant] = dict(resolved=sum(x['resolved'] for x in rows),
        recoveryCases=recovery, recoveries=len(recovery),
        modelSubstituteRequests=sum(x['modelCalls'] for x in rows),
        producerModelReservations=sum(x['producer']['modelRequests'] for x in rows),
        tools=sum(x['producer']['toolSteps'] for x in rows),
        publicTests=sum(x['producer']['publicTests'] for x in rows),
        gradingTestProcesses=sum(2 + ('privateGrade' in x) for x in rows if 'freshPublic' in x),
        promptBytes=sum(x['promptBytes'] for x in rows),
        retainedRegressions=sum(x['regression'] is True for x in rows),
        unknownRegressionGrades=sum(x['regression'] is None for x in rows),
        explicitRegressionRollbacks=decisions['rollback'],
        sameContextDuplicateEditsExecuted=sum(x['repeatedEdits'] for x in rows),
        suppressedDuplicateProposals=decisions['suppress_duplicate'],
        suppressedScopeProposals=decisions['suppress_scope'],
        exhausted=sum(x['producer']['status'] == 'exhausted' for x in rows),
        gradeOutcomes=dict(collections.Counter(x['gradeStatus'] for x in rows)))
audit = dict(description='Post-evaluation descriptive audit; frozen gate unchanged',
    aggregate=aggregate, frozenGate=r['gate'],
    evidenceSha256={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in source.iterdir() if p.is_file()})
(output / 'summary.json').write_text(json.dumps(audit, indent=2)+'\n')
lines = ['# All frozen held-out cases', '',
    'Each cell: outcome; model-substitute requests / producer tool steps / public tests; median producer milliseconds.',
    'Three counterbalanced repetitions per case; repetitions are not additional independent tasks.', '',
    '| Case | A conventional | B current Reparodynamic | C improved Reparodynamic |',
    '|---|---|---|---|']
for case in r['table']:
    cells=[]
    for v in 'ABC':
        x=case['variants'][v]
        status='resolved' if x['resolved'] else ('exhausted' if x['status']=='exhausted' else ('verifier '+x['gradeStatus'] if x['gradeStatus']!='completed' else 'unresolved'))
        cells.append(f"{status}; {x['modelRequests']}/{x['tools']}/{x['tests']}; {x['medianMs']} ms")
    lines.append('| '+case['caseId']+' | '+' | '.join(cells)+' |')
(output / 'comparison.md').write_text('\n'.join(lines)+'\n')
lines=['# Representative frozen traces', '', 'Events below are extracted from repetition 0, without rerunning or editing producer outcomes. Full event and candidate patches remain in results.json and producer-freeze.json.', '']
for case, variant in [('affine-prerequisites','B'),('affine-prerequisites','C'),('regression-alternative','C'),('repeated-regression','C'),('public-green-hidden-bug','C'),('uncertain-dispatch','C')]:
    row=next(x for x in r['rows'] if x['rep']==0 and x['caseId']==case and x['variant']==variant)
    lines += ['## '+case+' / '+variant, '', '```json']
    for event in row['producer']['events']:
        if event['kind'] in ['public_test','failure_memory','decision','strategy'] or (event['kind']=='action' and event['detail']['action'] in ['edit','test','finish']):
            lines.append(json.dumps(event,sort_keys=True))
    lines += [json.dumps({k:row.get(k) for k in ['patchDigest','freshPublic','privateGrade','gradeStatus','resolved']}), json.dumps({k:row['producer'][k] for k in ['status','reason','accountingComplete','unreconciledModelRequests']}),'```','']
(output / 'traces.md').write_text('\n'.join(lines))
print(json.dumps(aggregate,indent=2))
