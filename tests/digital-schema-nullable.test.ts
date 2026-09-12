import assert from "node:assert/strict";
import { test } from "node:test";
import { validateSchema, integerSchema, textSchema, type Schema } from "../src/digital-capabilities/schema.ts";
test("nullable bounded scalar expresses unknown without accepting malformed known values", () => {
  const nullable = { ...integerSchema(0, 100), nullable: true } as Schema;
  assert.doesNotThrow(() => validateSchema(nullable, null));
  assert.doesNotThrow(() => validateSchema(nullable, 15));
  for (const value of [-1, 101, 1.5, "12", {}, []]) assert.throws(() => validateSchema(nullable, value));
  assert.throws(() => validateSchema(integerSchema(), null));
  assert.throws(() => validateSchema({ ...textSchema(2), nullable: true } as Schema, "long"));
});
