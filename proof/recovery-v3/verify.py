"""Run full repository gate including typechecking the isolated candidate."""
from pathlib import Path
import os,subprocess,uuid
root=Path(__file__).resolve().parents[2]
source=root/'src'/('recovery-v3-check-'+uuid.uuid4().hex+'.ts')
try:
 with source.open('xb') as f:f.write((root/'proof/recovery-v3/candidate-producer.txt').read_bytes())
 cpus=','.join(map(str,sorted(os.sched_getaffinity(0))[:2]))
 result=subprocess.run(['taskset','-c',cpus,'npm','run','verify'],cwd=root)
 raise SystemExit(result.returncode)
finally:source.unlink(missing_ok=True)
