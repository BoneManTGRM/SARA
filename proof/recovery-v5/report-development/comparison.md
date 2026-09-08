# Complete policy comparison

15 fixture scenarios; 5 toy program families. Policies and repetitions are sensitivity conditions, not independent tasks. Each cell: grading outcome; producer status; requests/tools/public tests; median producer ms.

| Scenario | Policy | A conventional | B latest PR137 | C experiment |
|---|---|---|---|---|
| scale-batch | responsive | resolved; finished (model_finish); 11/16/3; 245 | unresolved; finished (model_finish); 12/16/3; 229 | resolved; finished (model_finish); 11/18/3; 193 |
| scale-batch | imperfect | resolved; finished (model_finish); 17/25/6; 408 | unresolved; finished (model_finish); 18/19/3; 194 | resolved; finished (model_finish); 17/21/3; 196 |
| scale-batch | unresponsive | unresolved; exhausted (PRODUCER_TEST_LIMIT); 16/24/6; 415 | unresolved; exhausted (limits); 50/34/2; 194 | unresolved; exhausted (limits); 50/36/2; 165 |
| range-batch | responsive | resolved; finished (model_finish); 11/16/3; 211 | unresolved; finished (model_finish); 12/16/3; 194 | resolved; finished (model_finish); 11/18/3; 161 |
| range-batch | imperfect | resolved; finished (model_finish); 17/25/6; 375 | unresolved; finished (model_finish); 18/19/3; 159 | resolved; finished (model_finish); 17/21/3; 226 |
| range-batch | unresponsive | unresolved; exhausted (PRODUCER_TEST_LIMIT); 16/24/6; 312 | unresolved; exhausted (limits); 50/34/2; 197 | unresolved; exhausted (limits); 50/36/2; 151 |
| price-batch | responsive | resolved; finished (model_finish); 11/16/3; 166 | unresolved; finished (model_finish); 12/16/3; 248 | resolved; finished (model_finish); 11/18/3; 179 |
| price-batch | imperfect | resolved; finished (model_finish); 17/25/6; 540 | unresolved; finished (model_finish); 18/19/3; 184 | resolved; finished (model_finish); 17/21/3; 215 |
| price-batch | unresponsive | unresolved; exhausted (PRODUCER_TEST_LIMIT); 16/24/6; 348 | unresolved; exhausted (limits); 50/34/2; 207 | unresolved; exhausted (limits); 50/36/2; 223 |
| prefix-can-regress | responsive | resolved; finished (model_finish); 11/16/3; 209 | unresolved; finished (model_finish); 12/16/3; 206 | resolved; finished (model_finish); 13/21/3; 199 |
| prefix-can-regress | imperfect | resolved; finished (model_finish); 17/25/6; 446 | unresolved; finished (model_finish); 18/19/3; 285 | resolved; finished (model_finish); 19/24/3; 267 |
| prefix-can-regress | unresponsive | unresolved; exhausted (PRODUCER_TEST_LIMIT); 16/24/6; 368 | unresolved; exhausted (limits); 50/34/2; 218 | unresolved; exhausted (limits); 50/36/2; 183 |
| direct-repair | responsive | resolved; finished (model_finish); 5/7/2; 141 | resolved; finished (model_finish); 5/7/2; 140 | resolved; finished (model_finish); 5/7/2; 116 |
| direct-repair | imperfect | resolved; finished (model_finish); 5/7/2; 156 | resolved; finished (model_finish); 5/7/2; 118 | resolved; finished (model_finish); 5/7/2; 140 |
| direct-repair | unresponsive | resolved; finished (model_finish); 5/7/2; 187 | resolved; finished (model_finish); 5/7/2; 179 | resolved; finished (model_finish); 5/7/2; 183 |
| red-baseline-composition | responsive | resolved; finished (model_finish); 15/22/4; 340 | resolved; finished (model_finish); 15/22/4; 384 | resolved; finished (model_finish); 15/22/4; 285 |
| red-baseline-composition | imperfect | unresolved; exhausted (PRODUCER_TEST_LIMIT); 18/27/6; 424 | unresolved; exhausted (PRODUCER_TEST_LIMIT); 18/27/6; 494 | unresolved; exhausted (PRODUCER_TEST_LIMIT); 18/27/6; 455 |
| red-baseline-composition | unresponsive | unresolved; exhausted (PRODUCER_TEST_LIMIT); 14/21/6; 396 | unresolved; exhausted (PRODUCER_TEST_LIMIT); 14/21/6; 439 | unresolved; exhausted (PRODUCER_TEST_LIMIT); 14/21/6; 394 |
| misleading-price-batch | responsive | resolved; finished (model_finish); 11/16/3; 186 | unresolved; finished (model_finish); 12/16/3; 227 | resolved; finished (model_finish); 11/18/3; 259 |
| misleading-price-batch | imperfect | resolved; finished (model_finish); 17/25/6; 415 | unresolved; finished (model_finish); 18/19/3; 216 | resolved; finished (model_finish); 17/21/3; 163 |
| misleading-price-batch | unresponsive | unresolved; exhausted (PRODUCER_TEST_LIMIT); 16/24/6; 434 | unresolved; exhausted (limits); 50/34/2; 208 | unresolved; exhausted (limits); 50/36/2; 169 |
| public-test-insufficient | responsive | unresolved; finished (model_finish); 5/7/2; 130 | unresolved; finished (model_finish); 5/7/2; 156 | unresolved; finished (model_finish); 5/7/2; 109 |
| public-test-insufficient | imperfect | unresolved; finished (model_finish); 5/7/2; 237 | unresolved; finished (model_finish); 5/7/2; 153 | unresolved; finished (model_finish); 5/7/2; 141 |
| public-test-insufficient | unresponsive | unresolved; finished (model_finish); 5/7/2; 127 | unresolved; finished (model_finish); 5/7/2; 146 | unresolved; finished (model_finish); 5/7/2; 143 |
| no-feasible-repair | responsive | unresolved; finished (model_finish); 6/8/2; 162 | unresolved; finished (model_finish); 7/10/2; 131 | unresolved; finished (model_finish); 7/10/2; 115 |
| no-feasible-repair | imperfect | unresolved; finished (model_finish); 12/17/5; 295 | unresolved; finished (model_finish); 13/13/2; 127 | unresolved; finished (model_finish); 13/13/2; 156 |
| no-feasible-repair | unresponsive | unresolved; exhausted (PRODUCER_TEST_LIMIT); 14/21/6; 475 | unresolved; exhausted (limits); 50/32/2; 185 | unresolved; exhausted (limits); 50/32/2; 174 |
| test-budget | responsive | unresolved; exhausted (PRODUCER_TEST_LIMIT); 24/36/6; 496 | unresolved; exhausted (PRODUCER_TEST_LIMIT); 24/36/6; 460 | unresolved; exhausted (PRODUCER_TEST_LIMIT); 24/36/6; 467 |
| test-budget | imperfect | unresolved; exhausted (PRODUCER_TEST_LIMIT); 16/24/6; 415 | unresolved; exhausted (PRODUCER_TEST_LIMIT); 16/24/6; 343 | unresolved; exhausted (PRODUCER_TEST_LIMIT); 16/24/6; 350 |
| test-budget | unresponsive | unresolved; exhausted (PRODUCER_TEST_LIMIT); 14/21/6; 335 | unresolved; exhausted (PRODUCER_TEST_LIMIT); 14/21/6; 395 | unresolved; exhausted (PRODUCER_TEST_LIMIT); 14/21/6; 425 |
| independent-verifier-unavailable | responsive | grade failed; finished (model_finish); 5/7/2; 99 | grade failed; finished (model_finish); 5/7/2; 116 | grade failed; finished (model_finish); 5/7/2; 153 |
| independent-verifier-unavailable | imperfect | grade failed; finished (model_finish); 5/7/2; 143 | grade failed; finished (model_finish); 5/7/2; 204 | grade failed; finished (model_finish); 5/7/2; 122 |
| independent-verifier-unavailable | unresponsive | grade failed; finished (model_finish); 5/7/2; 85 | grade failed; finished (model_finish); 5/7/2; 162 | grade failed; finished (model_finish); 5/7/2; 128 |
| authority-interruption | responsive | grade blocked; failed (FIXTURE_AUTHORITY_STOP); 1/2/1; 50 | grade blocked; failed (FIXTURE_AUTHORITY_STOP); 1/2/1; 42 | grade blocked; failed (FIXTURE_AUTHORITY_STOP); 1/2/1; 58 |
| authority-interruption | imperfect | grade blocked; failed (FIXTURE_AUTHORITY_STOP); 1/2/1; 69 | grade blocked; failed (FIXTURE_AUTHORITY_STOP); 1/2/1; 70 | grade blocked; failed (FIXTURE_AUTHORITY_STOP); 1/2/1; 78 |
| authority-interruption | unresponsive | grade blocked; failed (FIXTURE_AUTHORITY_STOP); 1/2/1; 57 | grade blocked; failed (FIXTURE_AUTHORITY_STOP); 1/2/1; 69 | grade blocked; failed (FIXTURE_AUTHORITY_STOP); 1/2/1; 68 |
| uncertain-accounting | responsive | grade blocked; failed (FIXTURE_UNCERTAIN_DISPATCH); 2/2/1; 67 | grade blocked; failed (FIXTURE_UNCERTAIN_DISPATCH); 2/2/1; 73 | grade blocked; failed (FIXTURE_UNCERTAIN_DISPATCH); 2/2/1; 49 |
| uncertain-accounting | imperfect | grade blocked; failed (FIXTURE_UNCERTAIN_DISPATCH); 2/2/1; 48 | grade blocked; failed (FIXTURE_UNCERTAIN_DISPATCH); 2/2/1; 47 | grade blocked; failed (FIXTURE_UNCERTAIN_DISPATCH); 2/2/1; 41 |
| uncertain-accounting | unresponsive | grade blocked; failed (FIXTURE_UNCERTAIN_DISPATCH); 2/2/1; 55 | grade blocked; failed (FIXTURE_UNCERTAIN_DISPATCH); 2/2/1; 44 | grade blocked; failed (FIXTURE_UNCERTAIN_DISPATCH); 2/2/1; 55 |
| scope-escalation | responsive | resolved; finished (model_finish); 13/19/4; 294 | resolved; finished (model_finish); 13/15/4; 250 | resolved; finished (model_finish); 13/15/4; 270 |
| scope-escalation | imperfect | unresolved; exhausted (PRODUCER_TEST_LIMIT); 16/24/6; 371 | resolved; exhausted (PRODUCER_TEST_LIMIT); 26/29/6; 404 | resolved; exhausted (PRODUCER_TEST_LIMIT); 26/29/6; 347 |
| scope-escalation | unresponsive | unresolved; exhausted (PRODUCER_TEST_LIMIT); 14/21/6; 339 | unresolved; exhausted (limits); 50/28/2; 166 | unresolved; exhausted (limits); 50/28/2; 184 |
| single-edit-delay | responsive | resolved; finished (model_finish); 9/13/3; 250 | resolved; finished (model_finish); 9/15/3; 219 | resolved; finished (model_finish); 9/15/3; 211 |
| single-edit-delay | imperfect | resolved; finished (model_finish); 15/22/6; 455 | resolved; finished (model_finish); 15/18/3; 222 | resolved; finished (model_finish); 15/18/3; 222 |
| single-edit-delay | unresponsive | unresolved; exhausted (PRODUCER_TEST_LIMIT); 14/21/6; 390 | unresolved; exhausted (limits); 50/32/2; 185 | unresolved; exhausted (limits); 50/32/2; 240 |
