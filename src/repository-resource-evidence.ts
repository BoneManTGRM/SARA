/** Qualification-only cgroup v2 evidence. A zero test exit cannot override a
 * killed child process, exhausted PID budget, missing counters, or reset data. */
export function repositoryResourceLimitsRespected(before: string | null, after: string | null): boolean {
  const read = (value: string | null) => {
    if (value === null) return null;
    const expressions = [/^oom (\d+)$/gm, /^oom_kill (\d+)$/gm, /^pids\.events\nmax (\d+)$/gm];
    const numbers: number[] = [];
    for (const expression of expressions) {
      const matches = [...value.matchAll(expression)];
      if (matches.length !== 1) return null;
      const number = Number(matches[0]![1]);
      if (!Number.isSafeInteger(number) || number < 0) return null;
      numbers.push(number);
    }
    return numbers;
  };
  const start = read(before), finish = read(after);
  return start !== null && finish !== null && start.every((n, i) => n === finish[i]);
}
