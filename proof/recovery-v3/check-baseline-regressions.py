"""Reproduce the stopping assertion failure against exact B, without changing C."""
from pathlib import Path
import subprocess,uuid,sys
root=Path(__file__).resolve().parents[2]
p=root/'tests'/('.v3-red-'+uuid.uuid4().hex+'.test.ts')
try:
 p.write_text((root/'tests/recovery-candidate-v3.test.ts').read_text().replace('../proof/recovery-v3/candidate-producer.txt','../proof/recovery-v3/current-producer.txt'))
 result=subprocess.run(['node','--import','tsx','--test',str(p)],cwd=root,capture_output=True,text=True)
 output=result.stdout+result.stderr;sys.stdout.write(output)
 if result.returncode!=1 or 'tests 2' not in output or 'fail 1' not in output:raise SystemExit('Expected one failure and one preserved-behavior pass; inspect output')
finally:p.unlink(missing_ok=True)
