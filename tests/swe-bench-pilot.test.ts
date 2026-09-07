import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateProgramCandidateStructure } from "../src/genome-lab.ts";

test("SWE-bench preparation protects selection, hidden answers, and truthful control outcomes", () => {
  const code = `
import importlib.util,json,random
spec=importlib.util.spec_from_file_location('pilot','scripts/swe-bench-pilot.py')
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
frozen=json.load(open('docs/benchmarks/swe-bench-multilingual-pilot.json'))
rows=[dict(row,problem_statement='public task',patch='SECRET_GOLD',test_patch='SECRET_TEST',hints_text='SECRET_HINT') for row in frozen['tasks']]
original=p.select(rows)
random.Random(123).shuffle(rows)
assert [r['instance_id'] for r in p.select(rows)]==[r['instance_id'] for r in original]
assert len(original)==10 and len({r['repo'] for r in original})==7
for row in rows:
 row['patch']='different reference';row['test_patch']='changed hidden tests'
assert [r['instance_id'] for r in p.select(rows)]==[r['instance_id'] for r in original]
assert set(p.agent_input(rows[0]))=={'instance_id','repo','base_commit','problem_statement'}
assert 'SECRET' not in json.dumps(p.agent_input(rows[0]))
try:p.select(rows+rows[:1]);raise AssertionError('duplicate accepted')
except ValueError:pass
base={'resolved':False,'tests_status':{'FAIL_TO_PASS':{'failure':['expected']},'PASS_TO_PASS':{'failure':[]}}}
gold={'resolved':True}
assert p.control_status(base,gold,True)
assert not p.control_status(base,gold) # Missing expected-test output is not a negative control.
assert not p.control_status(None,gold,True)
assert not p.control_status(base,{'resolved':False},True)
assert not p.control_status({'resolved':True},gold,True)
base['tests_status']['PASS_TO_PASS']['failure']=['regression']
assert not p.control_status(base,gold,True)
print('selection, answer separation, duplicates, missing results, missing test output, regressions: passed')
`;
  assert.match(execFileSync("python3", ["-c", code], { encoding: "utf8" }), /passed/);
});

test("SWE-bench preparation does not weaken the existing kernel to accept repository packages", () => {
  assert.throws(() => validateProgramCandidateStructure({
    schemaVersion: 1, candidateKind: "typescript_program", programName: "Repository probe",
    summary: "A repository requires a package manifest", limitations: [],
    files: [{ path: "package.json", content: "{}" },
      { path: "src/index.ts", content: "export const value = 1;" },
      { path: "tests/index.test.ts", content: "export const test = true;" }],
  }), /file paths/);
});

test("control workflow is branch-bound, has no paid launch, and retains every matrix failure", () => {
  const workflow = readFileSync(".github/workflows/swe-bench-controls.yml", "utf8");
  assert.match(workflow, /branches: \[feat\/swe-bench-multilingual-pilot\]/);
  assert.match(workflow, /fail-fast: false/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /if: always\(\)/);
  assert.doesNotMatch(workflow, /secrets\.|id-token: write|coding-benchmark\/run|OPENAI_API_KEY/);
});
