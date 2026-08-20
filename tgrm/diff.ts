import type { DiffHunk } from "./types";

function lcs(a: string[], b: string[]) {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const hunks: DiffHunk[] = [];
  let i = 0;
  let j = 0;
  const push = (type: DiffHunk["type"], text: string) => {
    const last = hunks[hunks.length - 1];
    if (last && last.type === type) last.text += `\n${text}`;
    else hunks.push({ type, text });
  };
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("eq", a[i]);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push("del", a[i]);
      i += 1;
    } else {
      push("ins", b[j]);
      j += 1;
    }
  }
  while (i < n) {
    push("del", a[i]);
    i += 1;
  }
  while (j < m) {
    push("ins", b[j]);
    j += 1;
  }
  return hunks;
}

export function lineDiff(before: string, after: string): DiffHunk[] {
  if (before === after) return [{ type: "eq", text: before }];
  return lcs(before.split("\n"), after.split("\n"));
}
