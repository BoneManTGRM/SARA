import { readFile, writeFile } from 'node:fs/promises';

async function replaceOnce(path, before, after) {
  const source = await readFile(path, 'utf8');
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`MISSING_EXPECTED_SNIPPET:${path}`);
  if (source.indexOf(before, first + 1) >= 0) throw new Error(`AMBIGUOUS_EXPECTED_SNIPPET:${path}`);
  await writeFile(path, source.slice(0, first) + after + source.slice(first + before.length));
}

// Memory records retain the exact historical failed baseline as applicability
// metadata only. It never serves as PASS authority.
await replaceOnce('src/coding-repair-memory.ts',
`export type RepairMemoryHit = RepairMemoryIdentity & { proposal: CodingRepairProposal };\ntype MemoryTransaction<T> = { value: T; changed: boolean };\ntype RecipeBody = { key: string; verifiedArtifactDigest: string; changes: CodingRepairProposal["changes"]; changedLines: number };`,
`export type RepairMemoryHit = RepairMemoryIdentity & { proposal: CodingRepairProposal; baselineVerification?: ProgramVerificationResult };\ntype MemoryTransaction<T> = { value: T; changed: boolean };\ntype RecipeBody = { key: string; verifiedArtifactDigest: string; changes: CodingRepairProposal["changes"]; changedLines: number;\n  scope?: string; baselineVerification?: ProgramVerificationResult };`);

await replaceOnce('src/coding-repair-memory.ts',
`function identity(r: RecipeBody): string {\n  return sha256(canonicalJson({ key: r.key, verifiedArtifactDigest: r.verifiedArtifactDigest, changes: r.changes, changedLines: r.changedLines }));\n}`,
`function identity(r: RecipeBody): string {\n  const body: RecipeBody = { key: r.key, verifiedArtifactDigest: r.verifiedArtifactDigest, changes: r.changes, changedLines: r.changedLines,\n    ...(r.scope && r.baselineVerification ? { scope: r.scope, baselineVerification: r.baselineVerification } : {}) };\n  return sha256(canonicalJson(body));\n}`);

await replaceOnce('src/coding-repair-memory.ts',
`    if (!r || Object.keys(r).sort().join() !== "changedLines,changes,evidenceDigests,id,key,quarantineDigest,verifiedArtifactDigest" ||\n        !isEvidenceDigest(r.key) || !isEvidenceDigest(r.id) || !isEvidenceDigest(r.verifiedArtifactDigest) || keys.has(r.key) ||`,
`    const shape = r && Object.keys(r).sort().join();\n    const legacyShape = "changedLines,changes,evidenceDigests,id,key,quarantineDigest,verifiedArtifactDigest";\n    const exactShape = "baselineVerification,changedLines,changes,evidenceDigests,id,key,quarantineDigest,scope,verifiedArtifactDigest";\n    if (!r || (shape !== legacyShape && shape !== exactShape) ||\n        !isEvidenceDigest(r.key) || !isEvidenceDigest(r.id) || !isEvidenceDigest(r.verifiedArtifactDigest) || keys.has(r.key) ||`);

await replaceOnce('src/coding-repair-memory.ts',
`      throw new Error("REPAIR_MEMORY_INVALID_RECORD");\n    }\n    const paths = new Set<string>();`,
`      throw new Error("REPAIR_MEMORY_INVALID_RECORD");\n    }\n    if (shape === exactShape) {\n      if (!isEvidenceDigest(r.scope)) throw new Error("REPAIR_MEMORY_INVALID_SCOPE");\n      assertCodingRepairVerification(r.baselineVerification);\n      if (r.baselineVerification.passed || !r.baselineVerification.failures.length) throw new Error("REPAIR_MEMORY_INVALID_BASELINE");\n    }\n    const paths = new Set<string>();`);

await replaceOnce('src/coding-repair-memory.ts',
`    const body: RecipeBody = { key, changes, changedLines: count, verifiedArtifactDigest: input.verification.artifactDigest };`,
`    const body: RecipeBody = { key, changes, changedLines: count, verifiedArtifactDigest: input.verification.artifactDigest,\n      scope: input.scope, baselineVerification: structuredClone(input.beforeVerification) };`);

await replaceOnce('src/coding-repair-memory.ts',
`  async lookup(candidate: ProgramCandidateProposal, verification: ProgramVerificationResult,\n    scope: string, strategy: "surgical" | "deep"): Promise<RepairMemoryHit | null> {`,
`  /** Exact-source lookup only avoids provisional search checks. Stored failure\n   * metadata is applicability-only; callers MUST perform fresh final verification. */\n  async lookupExactSource(candidate: ProgramCandidateProposal, scope: string, strategy: "surgical" | "deep"): Promise<RepairMemoryHit | null> {\n    candidate = structuredClone(candidate);\n    if (!isEvidenceDigest(scope)) throw new Error("REPAIR_MEMORY_INVALID_SCOPE");\n    validateProgramCandidateStructure(candidate);\n    if (strategy !== "surgical" && strategy !== "deep") return null;\n    const artifactDigest = codingRepairCandidateDigest(candidate);\n    return this.#transaction<RepairMemoryHit | null>(records => {\n      for (const r of records) {\n        if (r.quarantineDigest || r.scope !== scope || !r.baselineVerification) continue;\n        assertCodingRepairVerification(r.baselineVerification);\n        if (r.baselineVerification.passed || r.baselineVerification.artifactDigest !== artifactDigest || !r.baselineVerification.failures.length) continue;\n        const limit = strategy === "surgical" ? LIMITS.surgicalChangedLines : LIMITS.deepChangedLines;\n        const count = r.changes.reduce((n, change) => n + changedLines(candidate.files.find(f => f.path === change.path)?.content ?? "", change.replacementText), 0);\n        if (count !== r.changedLines || count > limit) continue;\n        const proposal: CodingRepairProposal = { schemaVersion: 1, baseArtifactDigest: artifactDigest,\n          failureFingerprint: r.baselineVerification.failures[0].fingerprint, strategy, changes: structuredClone(r.changes),\n          limitations: ["Exact-source learned repair; stored failure metadata is applicability-only; fresh final verification remains mandatory."] };\n        validateCodingRepairProposal({ proposal, candidate, artifactDigest,\n          failureFingerprints: new Set(r.baselineVerification.failures.map(f => f.fingerprint)), limits: LIMITS, expectedStrategy: strategy });\n        const replacements = new Map(proposal.changes.map(c => [c.path, c.replacementText]));\n        const after = { ...candidate, files: candidate.files.map(f => ({ ...f, content: replacements.get(f.path) ?? f.content })) };\n        if (codingRepairCandidateDigest(after) !== r.verifiedArtifactDigest) throw new Error("REPAIR_MEMORY_RESULT_MISMATCH");\n        return { value: { key: r.key, id: r.id, verifiedArtifactDigest: r.verifiedArtifactDigest, proposal,\n          baselineVerification: structuredClone(r.baselineVerification) }, changed: false };\n      }\n      return { value: null, changed: false };\n    }, true);\n  }\n\n  async lookup(candidate: ProgramCandidateProposal, verification: ProgramVerificationResult,\n    scope: string, strategy: "surgical" | "deep"): Promise<RepairMemoryHit | null> {`);

// Replace the reusable generator with a minimal exact-hit front door followed by
// the unchanged controller for every miss/fallback.
const reusable = await readFile('src/reusable-coding-candidate-generator.ts', 'utf8');
const marker = `    const coordinator = input.learningCoordinator ?? repairLearningCoordinator;`;
const markerIndex = reusable.indexOf(marker);
if (markerIndex < 0 || reusable.indexOf(marker, markerIndex + 1) >= 0) throw new Error('REUSABLE_MARKER');
const pre = reusable.slice(0, markerIndex);
const fast = `    const baseline = await input.base.generate(context);\n    if (!("candidateKind" in baseline) || baseline.candidateKind !== "typescript_program") return baseline;\n    if (!summary.memoryUnavailable && summary.scopeDigest) {\n      const lookupStarted = performance.now();\n      let exact: RepairMemoryHit | null = null;\n      try { exact = await input.memory.lookupExactSource(baseline, summary.scopeDigest, "surgical") ??\n        await input.memory.lookupExactSource(baseline, summary.scopeDigest, "deep"); }\n      catch { summary.memoryUnavailable = true; }\n      summary.reuseMilliseconds += performance.now() - lookupStarted;\n      if (exact) {\n        summary.hits++;\n        const replacement = new Map(exact.proposal.changes.map(change => [change.path, change]));\n        const repaired = { ...baseline, files: baseline.files.map(file => {\n          const change = replacement.get(file.path);\n          if (!change) return file;\n          if (sha256(file.content) !== change.expectedContentDigest) throw new Error("REPAIR_MEMORY_EXACT_SOURCE_DRIFT");\n          return { ...file, content: change.replacementText };\n        }) };\n        if (codingRepairCandidateDigest(repaired) !== exact.verifiedArtifactDigest) throw new Error("REPAIR_MEMORY_RESULT_MISMATCH");\n        try {\n          const checked = await (input.verifyFinal ?? input.verify)(structuredClone(repaired), context);\n          assertCodingRepairVerification(checked);\n          if (!checked.passed || checked.artifactDigest !== exact.verifiedArtifactDigest) throw new Error("REPAIR_EXACT_FINAL_FAILED");\n          summary.finalFreshVerification = true;\n          summary.reusedRecipes.push({ cycle: 1, recipeId: exact.id, key: exact.key, outcome: "verified_complete" });\n          summary.totalElapsedMilliseconds = performance.now() - started;\n          await input.onReuse(structuredClone(summary));\n          await input.memory.assertReusable(exact);\n          return repaired;\n        } catch (error) {\n          await input.memory.quarantine(exact.key, sha256("REPAIR_EXACT_FINAL_FAILED"));\n          summary.quarantines++;\n          throw error;\n        }\n      }\n    }\n`;
let next = pre + fast + reusable.slice(markerIndex);
// The base generator has already been called once. Reuse that exact immutable
// baseline when the normal controller is needed after an exact miss.
next = next.replace(`    const generator = createReparodynamicCandidateGenerator({ ...input,\n      model: { async propose(request) {`,
`    let baseConsumed = false;\n    const generator = createReparodynamicCandidateGenerator({ ...input, base: { ...input.base, generate: async () => {\n      if (baseConsumed) throw new Error("REPAIR_BASELINE_REUSED");\n      baseConsumed = true;\n      return structuredClone(baseline);\n    } },\n      model: { async propose(request) {`);
if (next === reusable) throw new Error('REUSABLE_NOT_CHANGED');
await writeFile('src/reusable-coding-candidate-generator.ts', next);

// New exact-source behavior tests; keep the existing broader suite intact.
await replaceOnce('tests/reusable-coding-candidate-generator.test.ts',
`test("cold learns, restarted warm lookup avoids the model and still performs three fresh verifications", () => fixture(async root => {`,
`test("cold learns, restarted exact warm lookup avoids the model and provisional search verifications", () => fixture(async root => {`);
await replaceOnce('tests/reusable-coding-candidate-generator.test.ts',
`  assert.equal(next.counter.calls, 0); assert.equal(calls, 3); assert.equal(next.summaries[0].hits, 1);`,
`  assert.equal(next.counter.calls, 0); assert.equal(calls, 1); assert.equal(next.summaries[0].hits, 1);`);
await replaceOnce('tests/reusable-coding-candidate-generator.test.ts',
`  o.verify = async c => { verifies++; return check(c, verifies > 2); };`,
`  o.verify = async c => { verifies++; return check(c, verifies > 1); };`);

await replaceOnce('tests/coding-repair-memory.test.ts',
`test("source, protected tests, metadata, failure fingerprint and scope changes each invalidate reuse", () => fixture(async memory => {`,
`test("exact-source lookup binds source and scope while storing failure metadata only for applicability", () => fixture(async memory => {\n  await memory.learn(training());\n  const hit = await memory.lookupExactSource(candidate(), scope, "surgical");\n  assert(hit); assert.equal(hit.baselineVerification?.passed, false);\n  const changed = candidate(); changed.files[0].content += "// exact-source drift\\n";\n  assert.equal(await memory.lookupExactSource(changed, scope, "surgical"), null);\n  assert.equal(await memory.lookupExactSource(candidate(), sha256("different scope"), "surgical"), null);\n}));\n\ntest("source, protected tests, metadata, failure fingerprint and scope changes each invalidate reuse", () => fixture(async memory => {`);

console.log('EXACT_REUSE_FASTPATH_TRANSFORMED');
