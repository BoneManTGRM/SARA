"""Build the reviewed, byte-pinned integration tree, without executing candidate code."""
from pathlib import Path
import re
import subprocess
import sys

MAIN = '0103cf266f052b8f9c14c4123280560902a77aca'
P70 = 'e07fe3e3965a8fea6d43efb3767e01595a7cecc9'
P90 = '23014289921e671f249ac62f598dbc831ceb6905'
P93 = 'a59facdfbaf05f35d8a4e0c87c5758cb5c003d76'
EXPECTED = 'b95834d559ade04c882aa9500016e9a8ac4fc378'
fixture = sys.argv[1]
changed = []

def source(ref, path):
    return subprocess.check_output(['git', 'show', ref + ':' + path]).decode('utf8')

def put(path, text):
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding='utf8')
    if path not in changed:
        changed.append(path)

def edit(path, old, new):
    text = Path(path).read_text(encoding='utf8')
    assert old in text, (path, old)
    put(path, text.replace(old, new))

assert subprocess.check_output(['git','rev-parse','HEAD']).decode().strip() == MAIN
modules = ['coding-repair-controller.ts','coding-repair-performance-gauge.ts','coding-repair-prompt.ts','coding-repair-tgrm-governance.ts','coding-repair-types.ts']
for name in modules:
    text = source(P70, 'src/' + name)
    text = re.sub(r'([\"\'])\./([^\"\']+)\1', lambda m: m[1] + ('./' if m[2] in modules else '../') + m[2] + m[1], text)
    put('src/experimental-v5/' + name, text)
for old in ['proof/reparodynamic-learning-v5.ts','tests/coding-repair-tgrm-v5.test.ts','tests/coding-repair-v5-performance-gauge.test.ts','tests/coding-repair-v5-cost-accounting.test.ts']:
    text = source(P70, old)
    for name in modules:
        text = text.replace('../src/' + name, '../src/experimental-v5/' + name)
    put(old.replace('tests/coding-repair-tgrm-v5.test.ts','tests/experimental-v5-novelty.test.ts'), text)

controller = 'src/experimental-v5/coding-repair-controller.ts'
helper = source(MAIN, 'src/coding-repair-benchmark-runner.ts')
helper = helper[helper.index('const BENCHMARK_LIMIT_CEILING ='):helper.index('// Evidence IDs')]
edit(controller, 'export async function runCodingRepairController(input:', helper + 'export async function runCodingRepairController(input:')
edit(controller, '  const limits = input.limits ?? INITIAL_CODING_REPAIR_LIMITS;', '''  const limits = snapshotLimits(input.limits);
  const baseline = structuredClone(input.baseline);
  const verify = input.verify;
  const propose = input.model.propose.bind(input.model);
  const onReceipt = input.onReceipt;''')
edit(controller, 'await input.verify(structuredClone(candidate))', 'await verify(structuredClone(candidate))')
edit(controller, 'let champion = structuredClone(input.baseline);', 'let champion = structuredClone(baseline);')
edit(controller, 'baseline: input.baseline,', 'baseline,')
edit(controller, 'const result = {\n    baseline,', 'const result = {\n    baseline: input.baseline,')
edit(controller, 'input.onReceipt?.', 'onReceipt?.')
edit(controller, 'input.model.propose({', 'propose({')
edit(controller, '    accountedCostUsd += response.accountedCostUsd;', '''    if (![response.inputTokens, response.outputTokens].every(value => Number.isSafeInteger(value) && value >= 0)) {
      throw new Error("Coding repair model returned invalid token accounting.");
    }
    accountedCostUsd += response.accountedCostUsd;''')
edit('src/experimental-v5/coding-repair-performance-gauge.ts', '  const behavioralChecks = knownBehavioralChecks(verification);', '''  if (typeof verification.passed !== "boolean" || !Number.isFinite(verification.score)
      || verification.score < 0 || verification.score > 1 || !Array.isArray(verification.failures)
      || (verification.passed && (verification.score !== 1 || verification.failures.length !== 0))) {
    throw new Error("Invalid coding repair verification result.");
  }
  const behavioralChecks = knownBehavioralChecks(verification);''')

for p in ['src/coding-repair-rejection.ts','proof/benchmark-run-admission.ts','proof/v7-failure-diagnostics.ts','tests/benchmark-run-admission.test.ts','tests/coding-repair-rejection.test.ts','tests/v7-failure-diagnostics.test.ts','proof/v7-live-fixture.ts','proof/v7-protected-test-source.ts','proof/v7-live-evaluation.ts']:
    put(p, source(P90, p))
edit('tests/coding-repair-rejection.test.ts', '../src/coding-repair-controller.ts', '../src/experimental-v5/coding-repair-controller.ts')
s = Path(controller).read_text()
s = 'import { CodingRepairRejectedAttemptError } from "../coding-repair-rejection.ts";\n' + s
start = s.index('    if (\n      !Number.isFinite(response.accountedCostUsd)')
end = s.index('\n    const proposalDigest', start)
block = s[start:end]
block = block.replace('    const applied = applyProposal(champion, response.proposal);','    applied = applyProposal(champion, response.proposal);')
block = block.replace('    if (![response.inputTokens','    accountedCostUsd += response.accountedCostUsd;\n    if (![response.inputTokens').replace('    accountedCostUsd += response.accountedCostUsd;\n    validate','    validate')
block = '    let applied: ReturnType<typeof applyProposal>;\n    try {\n' + ''.join('  ' + x + '\n' for x in block.splitlines()) + '''    } catch (error) {
      let rejectedProposalDigest: string | null = null;
      try { rejectedProposalDigest = digestCodingRepairProposal(response.proposal); } catch { /* Invalid proposal has no digest. */ }
      throw new CodingRepairRejectedAttemptError({
        error, cycle, retainedArtifactDigest: verification.artifactDigest,
        proposalDigest: rejectedProposalDigest, inputTokens: response.inputTokens,
        outputTokens: response.outputTokens, accountedCostUsd: response.accountedCostUsd,
        knownRunSpendUsd: accountedCostUsd,
      });
    }
'''
put(controller, s[:start] + block + s[end:])
edit('src/coding-repair-rejection.ts','  ["Coding repair schema version','  ["Coding repair model returned invalid token accounting.", "MODEL_TOKENS_INVALID"],\n  ["Coding repair schema version')
edit('proof/benchmark-run-admission.ts','const RETIRED = new Set([','const RETIRED = new Set([\n  "5fabd97aeb58eaa82cbe87395b533fe1636d42fbb1acda6a513b185cddabdfc2",')
edit('proof/benchmark-run-admission.ts','  const { grant, observed, now } = input;', '''  // Snapshot the admitted identities and ceiling before filesystem awaits.
  const { grant, observed, now } = structuredClone({ grant: input.grant, observed: input.observed, now: input.now });
  if (grant.experimentId === "41267154-ba42-496a-bb79-1656898ac716") throw new Error("RETIRED_CONTRACT");''')
edit('proof/v7-live-evaluation.ts','every(a=>a.error===null','every(a=>typeof a.verifiedComplete==="boolean" && a.error===null')

for p in ['src/experimental-compiler-cache.ts','proof/guarded-repair-memory.ts','tests/experimental-compiler-cache.test.ts','tests/guarded-repair-memory.test.ts','src/genome-lab.ts','src/genome-lab-verifier.ts']:
    put(p, source(P93, p))
mem = 'proof/guarded-repair-memory.ts'
edit(mem,'Object.keys(scope).length!==4||',"Object.keys(scope).length!==4||!['contract','dependencies','verifier','policy'].every(k=>Object.hasOwn(scope,k))||")
edit(mem,'if(!verification.passed||','if(verification.passed!==true||')
edit(mem,'!verification.evidenceDigests.length)',"!verification.evidenceDigests.length||!verification.evidenceDigests.every(d=>/^[a-f0-9]{64}$/u.test(d)))")
edit(mem,'if(before.files.length!==after.files.length||','if(new Set(before.files.map(f=>f.path)).size!==before.files.length||before.files.length!==after.files.length||')
edit(mem,'  const recipe=this.#recipes.get(key(candidate,scope));',"  if(strategy!=='surgical'&&strategy!=='deep')return null;\n  const recipe=this.#recipes.get(key(candidate,scope));")

for p in ['docs/PR70_INTEGRATION.md','docs/PR90_INTEGRATION.md','docs/PR93_INTEGRATION.md','proof/live-v7-comparison.ts','tests/experimental-v5-admission.test.ts','tests/experimental-integration-boundaries.test.ts']:
    put(p, source(fixture, p))
assert len(changed) == 30, changed
subprocess.run(['git','add','--',*changed], check=True)
tree = subprocess.check_output(['git','write-tree']).decode().strip()
assert tree == EXPECTED, (tree, EXPECTED)
print('REVIEWED_TREE_MATCH', tree)
