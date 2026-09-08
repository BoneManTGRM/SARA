# Complete policy comparison

13 tasks; three response policies are sensitivity conditions, not independent tasks. Each cell: outcome; requests/tools/public tests; median producer ms.

| Task | Policy | A conventional | B latest PR137 | C experiment |
|---|---|---|---|---|
| intercept-invariant | responsive | resolved; 11/16/3; 119 | resolved; 9/15/3; 115 | resolved; 9/15/3; 109 |
| intercept-invariant | imperfect | resolved; 17/25/6; 214 | resolved; 15/18/3; 108 | PRODUCER_REPEATED_FAILED_EDIT; 10/12/2; 81 |
| intercept-invariant | unresponsive | PRODUCER_TEST_LIMIT; 14/21/6; 215 | limits; 50/32/2; 89 | PRODUCER_REPEATED_FAILED_EDIT; 10/12/2; 68 |
| upper-bound-invariant | responsive | resolved; 11/16/3; 103 | resolved; 9/15/3; 107 | resolved; 9/15/3; 108 |
| upper-bound-invariant | imperfect | resolved; 17/25/6; 206 | resolved; 15/18/3; 103 | PRODUCER_REPEATED_FAILED_EDIT; 10/12/2; 78 |
| upper-bound-invariant | unresponsive | PRODUCER_TEST_LIMIT; 14/21/6; 199 | limits; 50/32/2; 82 | PRODUCER_REPEATED_FAILED_EDIT; 10/12/2; 73 |
| zero-price-invariant | responsive | resolved; 11/16/3; 114 | resolved; 9/15/3; 110 | resolved; 9/15/3; 112 |
| zero-price-invariant | imperfect | resolved; 17/25/6; 230 | resolved; 15/18/3; 144 | PRODUCER_REPEATED_FAILED_EDIT; 10/12/2; 73 |
| zero-price-invariant | unresponsive | PRODUCER_TEST_LIMIT; 14/21/6; 216 | limits; 50/32/2; 90 | PRODUCER_REPEATED_FAILED_EDIT; 10/12/2; 90 |
| straight-slope | responsive | resolved; 5/7/2; 79 | resolved; 5/7/2; 70 | resolved; 5/7/2; 70 |
| straight-slope | imperfect | resolved; 5/7/2; 70 | resolved; 5/7/2; 76 | resolved; 5/7/2; 73 |
| straight-slope | unresponsive | resolved; 5/7/2; 71 | resolved; 5/7/2; 69 | resolved; 5/7/2; 67 |
| baseline-red | responsive | resolved; 15/22/4; 171 | resolved; 15/22/4; 168 | resolved; 15/22/4; 146 |
| baseline-red | imperfect | PRODUCER_TEST_LIMIT; 18/27/6; 221 | PRODUCER_TEST_LIMIT; 18/27/6; 246 | PRODUCER_TEST_LIMIT; 18/27/6; 224 |
| baseline-red | unresponsive | PRODUCER_TEST_LIMIT; 14/21/6; 223 | PRODUCER_TEST_LIMIT; 14/21/6; 249 | PRODUCER_TEST_LIMIT; 14/21/6; 278 |
| misleading-loop | responsive | resolved; 11/16/3; 132 | resolved; 9/15/3; 146 | resolved; 9/15/3; 179 |
| misleading-loop | imperfect | resolved; 17/25/6; 255 | resolved; 15/18/3; 131 | PRODUCER_REPEATED_FAILED_EDIT; 10/12/2; 86 |
| misleading-loop | unresponsive | PRODUCER_TEST_LIMIT; 14/21/6; 216 | limits; 50/32/2; 91 | PRODUCER_REPEATED_FAILED_EDIT; 10/12/2; 87 |
| public-green-unresolved | responsive | unresolved; 5/7/2; 77 | unresolved; 5/7/2; 72 | unresolved; 5/7/2; 68 |
| public-green-unresolved | imperfect | unresolved; 5/7/2; 77 | unresolved; 5/7/2; 91 | unresolved; 5/7/2; 74 |
| public-green-unresolved | unresponsive | unresolved; 5/7/2; 70 | unresolved; 5/7/2; 73 | unresolved; 5/7/2; 73 |
| no-valid-domain-point | responsive | unresolved; 6/8/2; 70 | unresolved; 7/10/2; 88 | unresolved; 7/10/2; 73 |
| no-valid-domain-point | imperfect | unresolved; 12/17/5; 170 | unresolved; 13/13/2; 75 | PRODUCER_REPEATED_FAILED_EDIT; 10/12/2; 70 |
| no-valid-domain-point | unresponsive | PRODUCER_TEST_LIMIT; 14/21/6; 216 | limits; 50/32/2; 100 | PRODUCER_REPEATED_FAILED_EDIT; 10/12/2; 72 |
| test-ceiling | responsive | PRODUCER_TEST_LIMIT; 24/36/6; 235 | PRODUCER_TEST_LIMIT; 24/36/6; 270 | PRODUCER_TEST_LIMIT; 24/36/6; 275 |
| test-ceiling | imperfect | PRODUCER_TEST_LIMIT; 16/24/6; 221 | PRODUCER_TEST_LIMIT; 16/24/6; 215 | PRODUCER_TEST_LIMIT; 16/24/6; 227 |
| test-ceiling | unresponsive | PRODUCER_TEST_LIMIT; 14/21/6; 233 | PRODUCER_TEST_LIMIT; 14/21/6; 218 | PRODUCER_TEST_LIMIT; 14/21/6; 254 |
| verifier-failure | responsive | grade failed; 5/7/2; 75 | grade failed; 5/7/2; 75 | grade failed; 5/7/2; 70 |
| verifier-failure | imperfect | grade failed; 5/7/2; 76 | grade failed; 5/7/2; 68 | grade failed; 5/7/2; 70 |
| verifier-failure | unresponsive | grade failed; 5/7/2; 69 | grade failed; 5/7/2; 69 | grade failed; 5/7/2; 69 |
| authority-stop | responsive | FIXTURE_AUTHORITY_STOP; 1/2/1; 34 | FIXTURE_AUTHORITY_STOP; 1/2/1; 35 | FIXTURE_AUTHORITY_STOP; 1/2/1; 29 |
| authority-stop | imperfect | FIXTURE_AUTHORITY_STOP; 1/2/1; 30 | FIXTURE_AUTHORITY_STOP; 1/2/1; 32 | FIXTURE_AUTHORITY_STOP; 1/2/1; 37 |
| authority-stop | unresponsive | FIXTURE_AUTHORITY_STOP; 1/2/1; 34 | FIXTURE_AUTHORITY_STOP; 1/2/1; 44 | FIXTURE_AUTHORITY_STOP; 1/2/1; 32 |
| uncertain-dispatch | responsive | FIXTURE_UNCERTAIN_DISPATCH; 2/2/1; 36 | FIXTURE_UNCERTAIN_DISPATCH; 2/2/1; 35 | FIXTURE_UNCERTAIN_DISPATCH; 2/2/1; 31 |
| uncertain-dispatch | imperfect | FIXTURE_UNCERTAIN_DISPATCH; 2/2/1; 30 | FIXTURE_UNCERTAIN_DISPATCH; 2/2/1; 31 | FIXTURE_UNCERTAIN_DISPATCH; 2/2/1; 31 |
| uncertain-dispatch | unresponsive | FIXTURE_UNCERTAIN_DISPATCH; 2/2/1; 36 | FIXTURE_UNCERTAIN_DISPATCH; 2/2/1; 32 | FIXTURE_UNCERTAIN_DISPATCH; 2/2/1; 29 |
| deep-scope | responsive | resolved; 13/19/4; 169 | resolved; 13/15/4; 155 | resolved; 13/15/4; 155 |
| deep-scope | imperfect | PRODUCER_TEST_LIMIT; 16/24/6; 224 | resolved; 26/29/6; 219 | resolved; 26/29/6; 229 |
| deep-scope | unresponsive | PRODUCER_TEST_LIMIT; 14/21/6; 252 | limits; 50/28/2; 108 | limits; 50/28/2; 97 |
