"""Reproduce both new regression failures against frozen original source only."""
import pathlib, subprocess, uuid
root=pathlib.Path(__file__).resolve().parents[2]
name='.recovery-red-'+uuid.uuid4().hex
source=root/'src'/(name+'.ts')
test=root/'tests'/(name+'.test.ts')
try:
    source.write_bytes((root/'proof/recovery/baseline-producer.txt').read_bytes())
    test.write_text((root/'tests/repository-producer.test.ts').read_text().replace('../src/repository-producer.ts','../src/'+source.name))
    result=subprocess.run(['node','--import','tsx','--test','--test-name-pattern=prerequisite change|expanded anchors',str(test)],cwd=root)
    if result.returncode != 1:
        raise SystemExit('Expected baseline assertion failures, exit 1; inspect output before claiming regression reproduction')
finally:
    source.unlink(missing_ok=True)
    test.unlink(missing_ok=True)
