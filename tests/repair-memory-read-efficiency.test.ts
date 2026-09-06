import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableCodingRepairMemory } from '../src/coding-repair-memory.ts';
import { training, candidate, check, scope } from './helpers/repair-memory-fixture.ts';

test('small durable stores do not allocate the entire 2 MiB capacity on reads', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sara-small-memory-'));
  try {
    const memory = new DurableCodingRepairMemory(root);
    await memory.learn(training());
    const sizes: number[] = [];
    const allocate = Buffer.alloc;
    t.mock.method(Buffer, 'alloc', (size: number, ...args: any[]) => { sizes.push(size); return Reflect.apply(allocate, Buffer, [size, ...args]); });
    for (let i = 0; i < 4; i++) assert(await memory.lookup(candidate(), check(candidate()), scope, 'surgical'));
    assert(sizes.length > 0);
    assert(sizes.every(size => size < 16 * 1024), `unnecessarily allocated ${Math.max(...sizes)} bytes`);
  } finally { t.mock.restoreAll(); await rm(root, { recursive: true, force: true }); }
});
