"""Package exact committed source, local raw evidence and retained historical archive.
Run from a completed checkout: python proof/recovery-v4/package-evidence.py SCRATCH_OUTPUT_ROOT
"""
from pathlib import Path
import sys,json,hashlib,subprocess,zipfile,io
root=Path(__file__).resolve().parents[2];scratch=Path(sys.argv[1]).resolve();out=scratch/'SARA-recovery-v4-evidence.zip'
h=lambda b:hashlib.sha256(b).hexdigest()
report=(root/'proof/recovery-v4/report/REPORT.md').read_bytes()
(scratch/'SARA-recovery-v4-report.md').write_bytes(report)
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
files={'SARA-recovery-v4-report.md':report,'source.tar.gz':subprocess.check_output(['git','archive','--format=tar.gz',head],cwd=root),
 'round-four.patch':subprocess.check_output(['git','diff','be446f7bcf96b51caaa823bbfcd82ddd313981e1',head],cwd=root),
 'SOURCE-REVISIONS.json':json.dumps({'reportingLocal':head,'reportingTree':subprocess.check_output(['git','rev-parse','HEAD^{tree}'],cwd=root,text=True).strip(),**json.loads((root/'proof/recovery-v4/report/source-revisions.json').read_text())},indent=2).encode()}
for d in ['recovery-v4-dev-baseline','recovery-v4-dev-candidate','recovery-v4-heldout']:
 for f in (scratch/d).iterdir():
  if f.is_file():files[str(Path(d)/f.name)]=f.read_bytes()
for f in scratch.glob('recovery-v4-*.log'):files['logs/'+f.name]=f.read_bytes()
for f in (root/'proof/recovery-v4').rglob('*'):
 if f.is_file():files[str(f.relative_to(root))]=f.read_bytes()
files['tests/recovery-candidate-v4.test.ts']=(root/'tests/recovery-candidate-v4.test.ts').read_bytes()
files['docs/work-cards/recovery-batch-attribution.md']=(root/'docs/work-cards/recovery-batch-attribution.md').read_bytes()
prior=(scratch/'SARA-recovery-v3-evidence.zip').read_bytes()
assert h(prior)=='13191a1887b2ae6af117d8a5ad23e4d46b72448a42ad1419b4ecb32e63284e70'
files['history/SARA-recovery-v3-evidence.zip']=prior
manifest={name:h(data) for name,data in files.items()};files['SHA256SUMS.json']=json.dumps(manifest,indent=2).encode()
with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for name,data in files.items():z.writestr(name,data)
with zipfile.ZipFile(out) as z:
 assert z.testzip() is None
 for name,digest in manifest.items():assert h(z.read(name))==digest,name
print(json.dumps({'report':str(scratch/'SARA-recovery-v4-report.md'),'archive':str(out),'bytes':out.stat().st_size,'sha256':h(out.read_bytes()),'members':len(files),'everyMemberHashVerified':True},indent=2))
