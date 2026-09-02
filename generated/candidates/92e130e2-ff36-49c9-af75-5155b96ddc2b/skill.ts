export function runSkill(input: unknown): unknown {
  if (typeof input !== "string") return null;
  return input.trim().toLowerCase();
}
