/** A deliberately small, closed JSON-schema subset. No eval, coercion, defaults, or input-driven code. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Schema = {
  type: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null" | "json";
  nullable?: boolean;
  properties?: Record<string, Schema>; required?: string[]; additionalProperties?: boolean;
  items?: Schema; minItems?: number; maxItems?: number; minLength?: number; maxLength?: number;
  minimum?: number; maximum?: number; enum?: Json[]; pattern?: string;
};
export class CapabilityInputError extends Error {
  constructor(readonly code: string, readonly location = "$", message = "Input does not satisfy the capability contract.") {
    super(`${code}:${location}:${message}`); this.name = "CapabilityInputError";
  }
}
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

/** Snapshot without invoking getters/toJSON, accepting only finite, bounded, plain JSON values. */
export function snapshotJson(value: unknown, maximumBytes = 262_144): Json {
  const seen = new Set<object>(); let nodes = 0; let bytes = 0;
  function visit(item: unknown, depth: number): Json {
    if (++nodes > 20_000 || depth > 24) throw new CapabilityInputError("INPUT_LIMIT");
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new CapabilityInputError("NONFINITE_NUMBER");
      return Object.is(item, -0) ? 0 : item;
    }
    if (typeof item === "string") {
      bytes += Buffer.byteLength(item, "utf8");
      if (bytes > maximumBytes) throw new CapabilityInputError("INPUT_LIMIT");
      return item;
    }
    if (typeof item !== "object" || seen.has(item)) throw new CapabilityInputError("PLAIN_JSON_REQUIRED");
    const array = Array.isArray(item), prototype = Object.getPrototypeOf(item);
    if (!array && prototype !== Object.prototype && prototype !== null) throw new CapabilityInputError("PLAIN_JSON_REQUIRED");
    seen.add(item);
    try {
      const descriptors = Object.getOwnPropertyDescriptors(item);
      if (Reflect.ownKeys(item).some(key => typeof key !== "string")) throw new CapabilityInputError("PLAIN_JSON_REQUIRED");
      if (array) {
        if (item.length > 2_000 || Object.keys(descriptors).length !== item.length + 1) throw new CapabilityInputError("ARRAY_LIMIT_OR_SPARSE");
        const result: Json[] = [];
        for (let i = 0; i < item.length; i++) {
          const descriptor = descriptors[String(i)];
          if (!descriptor || !("value" in descriptor)) throw new CapabilityInputError("PLAIN_JSON_REQUIRED");
          result.push(visit(descriptor.value, depth + 1));
        }
        return result;
      }
      const result: Record<string, Json> = {};
      for (const key of Object.keys(descriptors).sort()) {
        const descriptor = descriptors[key]!;
        if (FORBIDDEN_KEYS.has(key) || !("value" in descriptor) || !descriptor.enumerable) throw new CapabilityInputError("UNSAFE_PROPERTY");
        bytes += Buffer.byteLength(key, "utf8");
        if (bytes > maximumBytes) throw new CapabilityInputError("INPUT_LIMIT");
        result[key] = visit(descriptor.value, depth + 1);
      }
      return result;
    } finally { seen.delete(item); }
  }
  const result = visit(value, 0);
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > maximumBytes) throw new CapabilityInputError("INPUT_LIMIT");
  return result;
}

export function validateSchema(schema: Schema, value: Json, path = "$"): void {
  const fail = (code: string): never => { throw new CapabilityInputError(code, path); };
  if (value === null && schema.nullable === true) return;
  if (schema.enum && !schema.enum.some(candidate => candidate === value)) fail("ENUM_MISMATCH");
  if (schema.type === "json") return;
  if (schema.type === "null") { if (value !== null) fail("TYPE_MISMATCH"); return; }
  if (schema.type === "object") {
    if (value === null || Array.isArray(value) || typeof value !== "object") fail("OBJECT_REQUIRED");
    const object = value as Record<string, Json>, properties = schema.properties ?? {};
    for (const key of schema.required ?? []) if (!Object.hasOwn(object, key)) fail(`MISSING_${key}`);
    for (const [key, entry] of Object.entries(object)) {
      if (!Object.hasOwn(properties, key)) { if (schema.additionalProperties !== true) fail(`UNEXPECTED_${key}`); }
      else validateSchema(properties[key]!, entry, `${path}.${key}`);
    }
    return;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) fail("ARRAY_REQUIRED");
    const array = value as Json[];
    if (array.length < (schema.minItems ?? 0) || array.length > (schema.maxItems ?? 500)) fail("ARRAY_BOUNDS");
    if (schema.items) array.forEach((item, index) => validateSchema(schema.items!, item, `${path}[${index}]`));
    return;
  }
  if (schema.type === "string") {
    if (typeof value !== "string") fail("STRING_REQUIRED");
    const text = value as string;
    if (text.length < (schema.minLength ?? 0) || text.length > (schema.maxLength ?? 16_384)) fail("STRING_BOUNDS");
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(text)) fail("STRING_PATTERN");
    return;
  }
  if (schema.type === "boolean") { if (typeof value !== "boolean") fail("BOOLEAN_REQUIRED"); return; }
  if (typeof value !== "number" || !Number.isFinite(value)) fail("NUMBER_REQUIRED");
  const number = value as number;
  if (schema.type === "integer" && !Number.isSafeInteger(number)) fail("SAFE_INTEGER_REQUIRED");
  if (number < (schema.minimum ?? -Number.MAX_SAFE_INTEGER) || number > (schema.maximum ?? Number.MAX_SAFE_INTEGER)) fail("NUMBER_BOUNDS");
}
export const objectSchema = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({type:"object",properties,required,additionalProperties:false});
export const textSchema = (maxLength = 4096, minLength = 1): Schema => ({type:"string",minLength,maxLength});
export const idSchema: Schema = {type:"string",minLength:1,maxLength:128,pattern:"^[A-Za-z0-9][A-Za-z0-9._:-]*$"};
export const digestSchema: Schema = {type:"string",pattern:"^[a-f0-9]{64}$",minLength:64,maxLength:64};
export const integerSchema = (minimum = 0, maximum = Number.MAX_SAFE_INTEGER): Schema => ({type:"integer",minimum,maximum});
export const arraySchema = (items: Schema, maxItems = 100, minItems = 0): Schema => ({type:"array",items,maxItems,minItems});
export const enumSchema = (...values: string[]): Schema => ({type:"string",enum:values,maxLength:128});
