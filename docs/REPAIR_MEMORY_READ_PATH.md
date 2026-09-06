# Exact-byte repair-memory read optimization

This change accelerates structural loading of the optional durable recipe store. It is not a cache of program verification, permissions, owner authority, or filesystem status.

Every operation still acquires the existing local I/O queue and filesystem lock, checks the current directory/file permissions, no-follow and single-link rules, checks the persistent disable marker, and reads the current file. The read buffer is the observed file size plus one byte instead of the 2 MiB maximum for every file. Partial reads are handled. The extra byte checks EOF; unexpected growth or truncation rejects the read. The store still has a 2 MiB limit.

A process-local cache memoizes only the parsed and structurally validated recipe records. A hit requires the same directory and exact equality of all freshly read bytes. Timestamps, inode identity, file length and a saved digest alone never qualify. The fixed validator checks the outer digest, every record identity, shape and limit on each new byte sequence. Invalid bytes evict an old snapshot. Results and saved input bytes are owned copies, so mutation of a returned proposal or an uncommitted transaction cannot poison a snapshot.

The cache retains at most four namespaces and 4 MiB of serialized input bytes, plus their bounded decoded representations; this is not a 4 MiB total-RSS guarantee. Eviction removes only this transient decoding optimization, never durable quarantine records. All write validation, fsync/rename, crash-lock and uncertain-quarantine-disable behavior remains. Changes made by another process, deletion, corrupted data, non-private files, hardlinks and symlinks are checked on the next operation before returning a proposal. The host account and configured private state directory remain trusted, as before; this is not authentication against a compromised host or protection against a later host rollback.

Owner/task/source/test/failure/runtime scope validation still happens per lookup. The new helper's source hash is included in implementation identity, so an old implementation-scoped recipe is not silently promoted across this release. Every repair keeps the existing controller/compiler/isolated behavioral/final/kernel checks. No generation call or PASS is coalesced by this change. The frozen benchmark and paid authorizations are unchanged.

## Verification and component measurements

`tests/repair-memory-read-efficiency.test.ts` first failed against PR115 because a tiny store allocated 2,097,153 bytes per read. The new read path passes without allocating the maximum buffer. Unit tests cover exact-byte identity, input/result isolation, failed validation, LRU and byte bounds, partial reads, growth, truncation and I/O errors. Store integration tests warm a snapshot before checking cross-process quarantine, same-length tampering with restored mtime, permissions, disable/crash locks, symlinks/hardlinks, deletion, corruption, oversized files and failed writes.

Run the whole suite with `npm run verify` in a credential-free environment. The existing real local HTTP/kernel restart and concurrent-job tests remain applicable and are part of that suite, not live-provider evidence.

For an isolated before/after store-read measurement:

```sh
node --import tsx proof/repair-memory-read-path.ts /path/to/PR115 /path/to/new-output-directory
```

The proof runs five alternating-order pairs of twenty lookups at 1, 32 and 128 stored records. It recreates the store object per read and reports setup separately. It uses one authored synthetic repair and fixture-shaped evidence under distinct scopes to exercise record-loading cost, not 128 independently solved tasks. No model, compiler delay or provider cost is simulated. Fresh file access, full key/proposal validation and copy costs remain in the measured path. Results are a memory-I/O component ratio, never a general live coding-speed claim. Equivalent ordinary memoization is a valid comparator/mechanism.

The new output directory must not exist. Preserve original outputs rather than selecting the best rerun. No historical paid benchmark launcher is needed to reproduce this proof.
