# All frozen held-out cases

Each cell: outcome; model-substitute requests / producer tool steps / public tests; median producer milliseconds.
Three counterbalanced repetitions per case; repetitions are not additional independent tasks.

| Case | A conventional | B current Reparodynamic | C improved Reparodynamic |
|---|---|---|---|
| affine-zero-invariant | resolved; 15/22/4; 143 ms | unresolved; 13/17/3; 107 ms | resolved; 18/23/4; 136 ms |
| clamp-lower-invariant | resolved; 15/22/4; 139 ms | unresolved; 13/17/3; 113 ms | resolved; 18/23/4; 139 ms |
| discount-zero-invariant | resolved; 13/19/4; 142 ms | unresolved; 11/14/3; 102 ms | resolved; 16/20/4; 142 ms |
| direct-affine | resolved; 5/7/2; 63 ms | resolved; 5/7/2; 64 ms | resolved; 5/7/2; 66 ms |
| regression-without-repeat | resolved; 13/19/3; 103 ms | resolved; 11/18/3; 106 ms | resolved; 11/18/3; 107 ms |
| already-failing-prerequisites | resolved; 15/22/4; 149 ms | resolved; 15/22/4; 140 ms | resolved; 15/22/4; 136 ms |
| public-pass-unresolved | unresolved; 5/7/2; 74 ms | unresolved; 5/7/2; 64 ms | unresolved; 5/7/2; 68 ms |
| misleading-repeat | resolved; 13/19/4; 143 ms | unresolved; 11/14/3; 116 ms | resolved; 16/20/4; 151 ms |
| no-alternative | unresolved; 8/11/3; 114 ms | unresolved; 11/14/3; 109 ms | unresolved; 12/14/3; 110 ms |
| ignores-rejection | resolved; 15/22/4; 168 ms | unresolved; 13/17/3; 110 ms | unresolved; 14/17/3; 111 ms |
| exhausted-search | exhausted; 24/36/6; 228 ms | exhausted; 24/36/6; 211 ms | exhausted; 24/36/6; 223 ms |
| independent-verifier-error | verifier failed; 5/7/2; 62 ms | verifier failed; 5/7/2; 65 ms | verifier failed; 5/7/2; 70 ms |
| authority-stops-dispatch | verifier blocked; 1/2/1; 28 ms | verifier blocked; 1/2/1; 31 ms | verifier blocked; 1/2/1; 30 ms |
| uncertain-call | verifier blocked; 2/2/1; 30 ms | verifier blocked; 2/2/1; 33 ms | verifier blocked; 2/2/1; 33 ms |
| scope-escalation-control | resolved; 13/19/4; 152 ms | resolved; 17/17/4; 136 ms | resolved; 17/17/4; 130 ms |
