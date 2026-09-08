import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { validateRepositoryJudgeConfiguration } from "../src/repository-official-judge.ts";

test("judge config requires absolute private paths and immutable official image", () => {
  const config = { environmentDigest: "a".repeat(64), datasetPath: "/judge/data.parquet", harnessPath: "/judge/harness", image: `swebench/task@sha256:${"b".repeat(64)}` };
  validateRepositoryJudgeConfiguration(config);
  assert.throws(() => validateRepositoryJudgeConfiguration({ ...config, image: "swebench/task:latest" }));
  assert.throws(() => validateRepositoryJudgeConfiguration({ ...config, datasetPath: "../data" }));
  assert.throws(() => validateRepositoryJudgeConfiguration({ ...config, fixtureProxyImage: "python:latest" }));
});

test("official judge binds task/patch/image and removes harness container privileges", () => {
  const code = `
import importlib.util,json,hashlib,tempfile,os
spec=importlib.util.spec_from_file_location('judge','scripts/swe-bench-judge.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
tasks=json.load(open('docs/benchmarks/swe-bench-multilingual-pilot.json'))['tasks']
r=dict(schemaVersion=1,instanceId=tasks[0]['instance_id'],repository=tasks[0]['repo'],baseCommit=tasks[0]['base_commit'],arm='conventional',runId='test-1',fixtureProxyImage=None,patch='',patchDigest=hashlib.sha256(b'').hexdigest(),environmentDigest='a'*64,taskDigest='b'*64,image=tasks[0]['image'].rsplit(':',1)[0]+'@sha256:'+'c'*64)
assert m.validate_request(r,tasks)==tasks[0]
fixture=dict(r,instanceId=tasks[7]['instance_id'],repository=tasks[7]['repo'],baseCommit=tasks[7]['base_commit'],image=tasks[7]['image'].rsplit(':',1)[0]+'@sha256:'+'c'*64,fixtureProxyImage='python@sha256:'+'e'*64)
assert m.validate_request(fixture,tasks)==tasks[7]
for changes in [dict(repository='wrong/repo'),dict(baseCommit='d'*40),dict(patch='forged'),dict(instanceId='not-selected'),dict(arm='extra'),dict(runId='../escape'),dict(image='swebench/other@sha256:'+'c'*64),dict(gold='secret'),dict(fixtureProxyImage='python@sha256:'+'e'*64)]:
 try:m.validate_request(dict(r,**changes),tasks)
 except ValueError:pass
 else:raise AssertionError(changes)
class Containers:
 def create(self,**kwargs):self.arguments=kwargs;return object()
c=Containers();restricted=m.RestrictedContainers(c,tasks[0]['base_commit'],'run-1')
restricted.create(image='image',cap_add=['SYS_ADMIN'])
assert c.arguments['network_mode']=='none' and c.arguments['cap_add']==[] and c.arguments['cap_drop']==['ALL']
assert c.arguments['network_disabled']==False
assert c.arguments['mem_limit']=='2g' and c.arguments['pids_limit']==256
assert c.arguments['labels']=={'sara.repositoryJudgeRun':'run-1'}
assert c.arguments['extra_hosts']=={'localhost':'127.0.0.1'}
try:restricted.create(image='image',volumes={'/host':{}})
except ValueError:pass
else:raise AssertionError('host mount accepted')
class Result:
 def __init__(self,code,output):self.exit_code=code;self.output=output
class Container:
 def start(self):pass
 def exec_run(self,command,**kwargs):
  if command[0]!='git':return Result(0,b'localhost diagnostics')
  assert command[:3]==['git','-c','safe.directory=/testbed']
  return Result(0,tasks[0]['base_commit'].encode() if command[3]=='rev-parse' else self.dirty)
with tempfile.TemporaryDirectory() as directory:
 previous=os.getcwd();os.chdir(directory)
 try:
  c=Container();c.dirty=b''
  m.CheckedContainer(c,tasks[0]['base_commit']).start()
  assert json.load(open('startup-diagnostics.json'))['lookup']['exitCode']==0
  c.dirty=b' M package.json'
  try:m.CheckedContainer(c,tasks[0]['base_commit']).start()
  except ValueError as e:assert 'package.json' in str(e)
  else:raise AssertionError('dirty judge image accepted')
  class PreactContainer(Container):
   def exec_run(self,command,**kwargs):
    if command[0]!='git':return Result(0,b'diagnostics')
    if command[3]=='rev-parse':return Result(0,tasks[2]['base_commit'].encode())
    if command[3]=='diff':return Result(0,b'original install-generated lockfile diff')
    if command[3]=='restore':self.dirty=b'';return Result(0,b'')
    return Result(0,self.dirty)
  c=PreactContainer();c.dirty=b' M package-lock.json\\n'
  m.CheckedContainer(c,tasks[2]['base_commit']).start()
  assert open('image-lockfile-normalization.diff','rb').read()==b'original install-generated lockfile diff'
  c.dirty=b' M package-lock.json\\n M src/index.js\\n'
  try:m.CheckedContainer(c,tasks[2]['base_commit']).start()
  except ValueError as e:assert 'src/index.js' in str(e)
  else:raise AssertionError('source drift normalized away')
 finally:os.chdir(previous)
print('PASS')
`;
  assert.match(execFileSync("python3", ["-c", code], { encoding: "utf8" }), /PASS/);
});

test("public environment recipes cover the unchanged ten tasks without judge data", () => {
  const frozen = JSON.parse(readFileSync("docs/benchmarks/swe-bench-multilingual-pilot.json", "utf8"));
  const recipes = JSON.parse(readFileSync("docs/benchmarks/swe-repository-recipes.json", "utf8"));
  assert.deepEqual(recipes.tasks.map((r: {instanceId: string}) => r.instanceId), frozen.tasks.map((r: {instance_id: string}) => r.instance_id));
  assert.doesNotMatch(JSON.stringify(recipes), /test_patch|model_patch|hints_text|sweb\.eval/);
  for (const recipe of recipes.tasks) assert.ok(recipe.installCommand.length && recipe.publicTestCommand.length);
});


test("Docusaurus setup normalization accepts only the observed Corepack metadata diff", () => {
  const code = `
import importlib.util,pathlib,tempfile,os,types
root=pathlib.Path.cwd()
spec=importlib.util.spec_from_file_location('judge',root/'scripts/swe-bench-judge.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
observed=(root/'tests/fixtures/docusaurus-image-metadata.diff').read_bytes()
base='0589b1475d56b0b541348aa56f201ec7c56c56d5'
class Container:
 def __init__(self,diff):self.diff=diff;self.dirty=b' M package.json\\n';self.restored=False
 def start(self):pass
 def exec_run(self,command,**kwargs):
  value=b'diagnostics'
  if command[0]=='git':
   if command[3]=='rev-parse':value=base.encode()
   elif command[3]=='diff':value=self.diff
   elif command[3]=='restore':self.restored=True;self.dirty=b'';value=b''
   else:value=self.dirty
  return types.SimpleNamespace(exit_code=0,output=value)
with tempfile.TemporaryDirectory() as directory:
 os.chdir(directory)
 c=Container(observed);m.CheckedContainer(c,base).start();assert c.restored
 assert pathlib.Path('image-package-manager-normalization.diff').read_bytes()==observed
 c=Container(observed+b'unknown change')
 try:m.CheckedContainer(c,base).start()
 except ValueError as e:assert 'BASE_MISMATCH' in str(e)
 else:raise AssertionError('unobserved manifest drift accepted')
 assert not c.restored
`;
  execFileSync("python3", ["-c", code], { encoding: "utf8" });
});
