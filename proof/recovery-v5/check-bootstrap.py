"""Offline clean-checkout prerequisite control using already-installed pinned dependencies."""
import pathlib, subprocess, tempfile, tarfile, io, os
root=pathlib.Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory(prefix='sara-bootstrap-control-') as tmp:
 p=pathlib.Path(tmp)
 data=subprocess.check_output(['git','archive','HEAD'],cwd=root)
 with tarfile.open(fileobj=io.BytesIO(data)) as tf:tf.extractall(p,filter='data')
 (p/'node_modules').symlink_to(root/'node_modules',target_is_directory=True)
 command=['node','--import','tsx','--test','tests/native-coding-verifier.test.ts']
 for name,expected in [('missing-pinned-compiler',1),('existing-pinned-compiler',0)]:
  if expected==0:(p/'tools/native-checker/node_modules').symlink_to(root/'tools/native-checker/node_modules',target_is_directory=True)
  result=subprocess.run(command,cwd=p,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
  print(name,'expected',expected,'actual',result.returncode,flush=True)
  print(result.stdout,flush=True)
  assert result.returncode==expected
print('No provider calls; no downloads. This controls dependency presence, not a fresh hosted workflow execution.')
