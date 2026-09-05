# Benchmark rejection diagnostics and replay safety

The active PR90 implementation is now integrated with the trusted owner launcher. See [Supervised benchmark integration](supervised-benchmark-integration.md) for the execution boundary, remaining operational prerequisites, verification and historical-evidence treatment.

The owner-side admission helper and controller validation behavior from `fbd12c6100f325fb46b16bc9f07d0e27ac403613` are preserved. The launcher now claims before SSH, the worker has no provider key, and current integration contracts are offline-only. This is not a deployed production feature or authorization for another paid trial.

Both historical V7 controls remain unclassified failures. Their missing original error/source cannot be reconstructed by the new diagnostics. Both live comparisons remain inconclusive. No old result or consumed authorization has been replaced or reused.
