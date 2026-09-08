# All frozen held-out cases

Each cell: outcome; model-substitute requests / producer tool steps / public tests; median producer milliseconds.
Three counterbalanced repetitions per case; repetitions are not additional independent tasks.

| Case | A conventional | B current Reparodynamic | C improved Reparodynamic |
|---|---|---|---|
| affine-prerequisites | resolved; 15/22/4; 161 ms | unresolved; 18/22/4; 146 ms | resolved; 15/22/4; 149 ms |
| clamp-bounds | resolved; 15/22/4; 144 ms | unresolved; 18/22/4; 138 ms | resolved; 15/22/4; 149 ms |
| discount-fee | resolved; 15/22/4; 157 ms | unresolved; 18/22/4; 161 ms | resolved; 15/22/4; 145 ms |
| straight-repair | resolved; 5/7/2; 71 ms | resolved; 5/7/2; 72 ms | resolved; 5/7/2; 87 ms |
| regression-alternative | resolved; 9/13/3; 121 ms | resolved; 9/15/3; 112 ms | resolved; 9/15/3; 126 ms |
| repeated-regression | resolved; 11/16/4; 150 ms | unresolved; 11/14/3; 112 ms | unresolved; 11/14/3; 111 ms |
| public-green-hidden-bug | unresolved; 5/7/2; 72 ms | unresolved; 5/7/2; 75 ms | unresolved; 5/7/2; 72 ms |
| misleading-output | resolved; 15/22/4; 153 ms | unresolved; 18/22/4; 152 ms | resolved; 15/22/4; 171 ms |
| deep-whole-file | resolved; 13/19/4; 154 ms | resolved; 17/17/4; 154 ms | resolved; 17/17/4; 150 ms |
| unsolvable-test-limit | exhausted; 24/36/6; 231 ms | exhausted; 24/36/6; 233 ms | exhausted; 24/36/6; 254 ms |
| verifier-unavailable | verifier failed; 5/7/2; 68 ms | verifier failed; 5/7/2; 66 ms | verifier failed; 5/7/2; 75 ms |
| authority-interruption | verifier blocked; 1/2/1; 30 ms | verifier blocked; 1/2/1; 32 ms | verifier blocked; 1/2/1; 30 ms |
| uncertain-dispatch | verifier blocked; 2/2/1; 33 ms | verifier blocked; 2/2/1; 33 ms | verifier blocked; 2/2/1; 34 ms |
