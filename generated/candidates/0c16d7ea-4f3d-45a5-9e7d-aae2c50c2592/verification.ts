import { runSkill } from "./skill.ts";
const vectors = [{"name":"normalizes text","input":"  RELEASE PASS  ","expected":"release pass"},{"name":"rejects non-string input","input":42,"expected":null}] as const;
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, normalize(record[key])]));
  }
  return value;
}
for (const vector of vectors) {
  const observed = await Promise.resolve(runSkill(structuredClone(vector.input)));
  const actualJson = JSON.stringify(normalize(observed));
  const expectedJson = JSON.stringify(normalize(vector.expected));
  if (actualJson !== expectedJson) throw new Error(`Behavioral test failed: ${vector.name}`);
}
console.log(JSON.stringify({ result: "PASS", tests: vectors.length }));
