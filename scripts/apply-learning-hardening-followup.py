from pathlib import Path


def replace_exact(path: str, old: str, new: str, expected: int = 1) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    assert count == expected, f"{path}: expected {expected} occurrence(s), found {count}"
    p.write_text(text.replace(old, new))


# Classify the exact, already-allowlisted candidate metadata failures as repairable schema failures.
replace_exact(
    "src/learning-acceleration.ts",
    'if (/schema version|structurally incomplete|unsupported fields|not valid json|ambiguous|proposal.+(?:schema|json)/iu.test(text)) {',
    'if (/schema version|structurally incomplete|unsupported fields|not valid json|ambiguous|proposal.+(?:schema|json)|skill name must be|skill candidate summary must be|skill limitations must contain|behavioral test names must be unique/iu.test(text)) {',
)

# Preserve only already-sanitized compiler diagnostics when proposalPrompt receives their string form.
replace_exact(
    "src/cloudflare-free-generator.ts",
    '''    const safeDirective = repairFeedback?.startsWith("TARGETED_REPAIR:")
      ? repairFeedback.slice(0, 1_500)
      : boundedCandidateFailureFeedback(new Error(repairFeedback || "Candidate verification failed; no earlier gate is asserted to have passed.")).slice(0, 1_500);''',
    '''    const compilerLines = repairFeedback?.split("\\n") ?? [];
    const safeCompilerLine = (line: string) =>
      /^TS\\d{3,5} at skill\\.ts:\\d+:\\d+(?:: (?:A value of type unknown must be narrowed before use\\.|A value may be undefined; narrow it before accessing its fields\\.))?$/u.test(line);
    const safeCompilerFeedback = compilerLines.length > 0 && compilerLines.length <= 9 && (
      (compilerLines.length === 1 && safeCompilerLine(compilerLines[0]!)) ||
      (/^Generated skill failed TypeScript verification with \\d+ error\\(s\\)\\.$/u.test(compilerLines[0]!) &&
        compilerLines.slice(1).every(safeCompilerLine))
    );
    const safeDirective = repairFeedback?.startsWith("TARGETED_REPAIR:")
      ? repairFeedback.slice(0, 1_500)
      : safeCompilerFeedback
        ? repairFeedback!.slice(0, 1_500)
        : boundedCandidateFailureFeedback(new Error(repairFeedback || "Candidate verification failed; no earlier gate is asserted to have passed.")).slice(0, 1_500);''',
)

# After the first hardening script bounds non-campaign learning memory, keep the relevant
# failure lesson ahead of generic anchors so a restart can actually use the measured repair evidence.
replace_exact(
    "src/kernel.ts",
    '''        : learning
          ? [...recalled.anchors, ...recalled.relevant].slice(0, attemptBudget.relevantMemoryMaximum).map(memory => ({
              ...memory, statement: memory.statement.slice(0, Math.min(1_200, attemptBudget.relevantMemoryCharacterMaximum)),
            }))
          : [...recalled.anchors, ...recalled.relevant].slice(0, 12);''',
    '''        : learning
          ? [...recalled.relevant, ...recalled.anchors].slice(0, attemptBudget.relevantMemoryMaximum).map(memory => ({
              ...memory, statement: memory.statement.slice(0, Math.min(1_200, attemptBudget.relevantMemoryCharacterMaximum)),
            }))
          : [...recalled.anchors, ...recalled.relevant].slice(0, 12);''',
)

# Preserve the established "blocked" result after the bounded daily/campaign allowance is consumed,
# while still selecting an authorized/running job first so retained reservations can recover.
replace_exact(
    "src/kernel.ts",
    '''      if (!job) return undefined;''',
    '''      if (!job) {
        const dailyReservations = reservations.filter(event => event.occurredAt.slice(0,10) === now.slice(0,10)).length;
        return ((campaign && campaignAccounting(campaign, state.events).remaining === 0) || dailyReservations >= 2) ? null : undefined;
      }''',
)

# Keep the triage expression simple and exact.
replace_exact(
    "src/kernel.ts",
    '''      const triage = learningFailureTriage(independentFailure ? independentFailure ? new Error("Independent acceptance failed; hidden answers withheld.") : error : error);''',
    '''      const triage = learningFailureTriage(independentFailure ? new Error("Independent acceptance failed; hidden answers withheld.") : error);''',
)

# Update only expectations intentionally changed by the bounded learning contract.
replace_exact(
    "tests/autonomous-learning.test.ts",
    '''  assert.equal((prompt.match(/"evidence":/g)??[]).length,4);''',
    '''  assert.equal((prompt.match(/"evidence":/g)??[]).length,2);''',
)

p = Path("tests/cloudflare-free-generator.test.ts")
text = p.read_text()
assert text.count("assert.equal(requests[1].max_completion_tokens, 8192);") == 2
text = text.replace("assert.equal(requests[1].max_completion_tokens, 8192);", "assert.equal(requests[1].max_completion_tokens, 2048);")
assert text.count("assert.equal(request.max_completion_tokens, 8_192);") == 1
text = text.replace("assert.equal(request.max_completion_tokens, 8_192);", "assert.equal(request.max_completion_tokens, 2_048);")
assert text.count("/Previous rejected proposal:/") == 1
text = text.replace("/Previous rejected proposal:/", "/Previous rejected candidate \\(bounded repair context\\):/")
assert text.count("/Bounded independent verifier feedback:/") == 1
text = text.replace("/Bounded independent verifier feedback:/", "/Measured repair directive:/")
p.write_text(text)

replace_exact(
    "tests/cloudflare-learning-feedback.test.ts",
    r'''    assert.match(prompt, /Bounded independent verifier feedback: Generated skill is not a pure isolated candidate: computed property access is prohibited\./);''',
    r'''    assert.match(prompt, /Measured repair directive: Generated skill is not a pure isolated candidate: computed property access is prohibited\./);''',
)

for path in ["tests/cloudflare-metadata-feedback.test.ts", "tests/cloudflare-undefined-feedback.test.ts"]:
    replace_exact(
        path,
        '''    assert.equal(repairRequest?.max_completion_tokens, 8192);''',
        '''    assert.equal(repairRequest?.max_completion_tokens, 2048);''',
    )

p = Path("tests/learning-campaign.test.ts")
text = p.read_text()
assert text.count('original.indexOf("Previous rejected proposal:")') == 1
assert text.count('reordered.indexOf("Previous rejected proposal:")') == 1
text = text.replace('original.indexOf("Previous rejected proposal:")', 'original.indexOf("Previous rejected candidate (bounded repair context):")')
text = text.replace('reordered.indexOf("Previous rejected proposal:")', 'reordered.indexOf("Previous rejected candidate (bounded repair context):")')
p.write_text(text)

print("follow-up hardening applied")
