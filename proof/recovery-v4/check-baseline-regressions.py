"""Expect all three v4 assertions to fail against the unchanged B snapshot."""
from pathlib import Path
import os,subprocess
root=Path(__file__).resolve().parents[2]
r=subprocess.run(['node','--import','tsx','--test','tests/recovery-candidate-v4.test.ts'],cwd=root,env={**os.environ,'SARA_V4_BASELINE':'1'},capture_output=True,text=True)
print(r.stdout+r.stderr)
assert r.returncode==1 and ('fail 3' in r.stdout or '# fail 3' in r.stdout)
print('EXPECTED_BASELINE_REGRESSIONS_CONFIRMED')
