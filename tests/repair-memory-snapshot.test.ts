import assert from "node:assert/strict";
import { test } from "node:test";
import { ExactByteSnapshotCache, readExactMemoryBytes } from "../src/repair-memory-snapshot.ts";

const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));

test("exact-byte hits avoid repeated parsing but return isolated values", () => {
  let calls = 0;
  const cache = new ExactByteSnapshotCache(text => { calls++; return JSON.parse(text); });
  const input = bytes({ items: [{ value: 1 }] });
  const first = cache.decode("a", input); first.items[0].value = 2;
  const hit = cache.decode("a", Buffer.from(input)); hit.items[0].value = 3;
  assert.equal(cache.decode("a", input).items[0].value, 1);
  assert.equal(calls, 1);
});

test("changed bytes and namespace force revalidation, including equal-length replacements", () => {
  let calls = 0;
  const cache = new ExactByteSnapshotCache(text => { calls++; return JSON.parse(text); });
  const a = bytes({ x: 1 }), b = bytes({ x: 2 });
  assert.equal(a.length, b.length);
  assert.equal(cache.decode("owner-a", a).x, 1);
  assert.equal(cache.decode("owner-a", b).x, 2);
  assert.equal(cache.decode("owner-b", b).x, 2);
  assert.equal(calls, 3);
});

test("mutating an input buffer or decoder-owned value cannot poison a retained snapshot", () => {
  let owned: { x: number };
  let calls = 0;
  const cache = new ExactByteSnapshotCache(text => { calls++; owned = JSON.parse(text); return owned; });
  const input = bytes({ x: 1 });
  cache.decode("a", input); owned!.x = 9; input.fill(0);
  assert.equal(cache.decode("a", bytes({ x: 1 })).x, 1);
  assert.throws(() => cache.decode("a", input));
  assert.equal(calls, 2);
});

test("invalid replacement bytes discard the old snapshot and are never cached", () => {
  let calls = 0;
  const cache = new ExactByteSnapshotCache(text => { calls++; const n = JSON.parse(text); if (n !== 1) throw Error("invalid"); return n; });
  cache.decode("a", bytes(1));
  assert.throws(() => cache.decode("a", bytes(2)));
  assert.throws(() => cache.decode("a", bytes(2)));
  assert.equal(cache.decode("a", bytes(1)), 1);
  assert.equal(calls, 4);
});

test("LRU retains at most four namespaces and eviction never becomes acceptance", () => {
  let calls = 0;
  const cache = new ExactByteSnapshotCache(text => { calls++; return JSON.parse(text); });
  for (const key of ["a", "b", "c", "d"]) cache.decode(key, bytes(1));
  cache.decode("a", bytes(1)); cache.decode("e", bytes(1));
  assert.equal(calls, 5);
  cache.decode("a", bytes(1)); assert.equal(calls, 5);
  cache.decode("b", bytes(1)); assert.equal(calls, 6);
});

test("retained input bytes are bounded independently of namespace count", () => {
  let calls = 0;
  const cache = new ExactByteSnapshotCache(text => { calls++; return text.length; });
  const input = Buffer.alloc(1_500_000, 32);
  for (const key of ["a", "b", "c"]) cache.decode(key, input);
  cache.decode("b", input); assert.equal(calls, 3);
  cache.decode("a", input); assert.equal(calls, 4); // Three copies exceed 4 MiB.
});

test("oversized entries may be decoded by a standalone cache but are never retained", () => {
  let calls = 0;
  const cache = new ExactByteSnapshotCache(text => { calls++; return text.length; });
  const input = Buffer.alloc(2 * 1024 * 1024 + 1, 32);
  cache.decode("a", input); cache.decode("a", input); assert.equal(calls, 2);
});

function reader(content: Buffer, chunk = content.length || 1) {
  let position = 0;
  const allocations: number[] = [];
  return { allocations, async read(buffer: Buffer, offset: number, length: number, _position: null) {
    allocations.push(buffer.length);
    const n = Math.min(chunk, length, content.length - position);
    content.copy(buffer, offset, position, position + n); position += n;
    return { bytesRead: n };
  } };
}

test("bounded reader handles partial reads and allocates observed size plus one", async () => {
  const content = Buffer.from("small persisted data"); const file = reader(content, 3);
  assert.deepEqual(await readExactMemoryBytes(file, content.length), content);
  assert(file.allocations.every(n => n === content.length + 1));
});

test("bounded reader checks EOF even on an empty file", async () => {
  const file = reader(Buffer.alloc(0));
  assert.equal((await readExactMemoryBytes(file, 0)).length, 0);
  assert.deepEqual(file.allocations, [1]);
  await assert.rejects(readExactMemoryBytes(reader(Buffer.from("x")), 0), /SIZE_CHANGED/);
});

test("growth and truncation fail closed instead of validating an old prefix", async () => {
  await assert.rejects(readExactMemoryBytes(reader(Buffer.from("valid-plus-extra"), 2), 5), /SIZE_CHANGED/);
  await assert.rejects(readExactMemoryBytes(reader(Buffer.from("short"), 2), 6), /SIZE_CHANGED/);
});

test("invalid sizes and dishonest read counts fail before accepting bytes", async () => {
  for (const size of [-1, 0.5, NaN, Infinity, 2 * 1024 * 1024 + 1])
    await assert.rejects(readExactMemoryBytes(reader(Buffer.alloc(0)), size), /MEMORY_SIZE/);
  for (const bytesRead of [-1, NaN, 0.5, 3])
    await assert.rejects(readExactMemoryBytes({ read: async () => ({ bytesRead }) }, 1), /INVALID_READ/);
});

test("the maximum-size valid file is accepted; I/O errors remain errors", async () => {
  const content = Buffer.alloc(2 * 1024 * 1024, 65);
  assert.deepEqual(await readExactMemoryBytes(reader(content, 8192), content.length), content);
  await assert.rejects(readExactMemoryBytes({ read: async () => { throw Error("read fault"); } }, 12), /read fault/);
});
