"""Reproduce the two continuation assertions against exact pre-change B source."""
import pathlib, subprocess, uuid, sys
root=pathlib.Path(__file__).resolve().parents[2]
name='.recovery-v2-red-'+uuid.uuid4().hex
source=root/'src'/(name+'.ts')
test=root/'tests'/(name+'.test.ts')
try:
    source.write_bytes((root/'proof/recovery-v2/current-producer.txt').read_bytes())
    test.write_text((root/'tests/repository-producer.test.ts').read_text().replace('../src/repository-producer.ts','../src/'+source.name))
    result=subprocess.run(['node','--import','tsx','--test','--test-name-pattern=recovery continuation',str(test)],cwd=root,capture_output=True,text=True)
    combined=result.stdout+result.stderr
    sys.stdout.write(combined)
    if result.returncode != 1 or 'tests 2' not in combined or 'fail 2' not in combined:
        raise SystemExit('Expected two baseline assertion failures; inspect output')
finally:
    source.unlink(missing_ok=True)
    test.unlink(missing_ok=True)
