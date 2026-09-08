# Complete policy comparison

15 fixture scenarios; five toy program families. Policies and repetitions are sensitivity conditions, not independent tasks. Each cell: grading outcome; producer status; requests/tools/public tests; median producer ms.

| Scenario | Policy | A conventional | B latest PR137 | C experiment |
|---|---|---|---|---|
| scale-batch | responsive | resolved; finished (model_finish); 11/16/3; 128 | unresolved; finished (model_finish); 12/16/3; 117 | resolved; finished (model_finish); 11/18/3; 135 |
| scale-batch | imperfect | resolved; finished (model_finish); 17/25/6; 216 | unresolved; finished (model_finish); 18/19/3; 118 | resolved; finished (model_finish); 17/21/3; 121 |
| scale-batch | unresponsive | unresolved; exhausted (PRODUCER_TEST_LIMIT); 16/24/6; 207 | unresolved; exhausted (limits); 50/34/2; 85 | resolved; exhausted (limits); 50/36/2; 88 |
| range-batch | responsive | resolved; finished (model_finish); 11/16/3; 105 | unresolved; finished (model_finish); 12/16/3; 113 | resolved; finished (model_finish); 11/18/3; 108 |
| range-batch | imperfect | resolved; finished (model_finish); 17/25/6; 214 | unresolved; finished (model_finish); 18/19/3; 112 | resolved; finished (model_finish); 17/21/3; 112 |
| range-batch | unresponsive | unresolved; exhausted (PRODUCER_TEST_LIMIT); 16/24/6; 213 | unresolved; exhausted (limits); 50/34/2; 88 | resolved; exhausted (limits); 50/36/2; 93 |
| price-batch | responsive | resolved; finished (model_finish); 11/16/3; 112 | unresolved; finished (model_finish); 12/16/3; 108 | resolved; finished (model_finish); 11/18/3; 109 |
| price-batch | imperfect | resolved; finished (model_finish); 17/25/6; 217 | unresolved; finished (model_finish); 18/19/3; 116 | resolved; finished (model_finish); 17/21/3; 109 |
| price-batch | unresponsive | unresolved; exhausted (PRODUCER_TEST_LIMIT); 16/24/6; 221 | unresolved; exhausted (limits); 50/34/2; 86 | resolved; exhausted (limits); 50/36/2; 94 |
| prefix-can-regress | responsive | resolved; finished (model_finish); 11/16/3; 107 | unresolved; finished (model_finish); 12/16/3; 104 | resolved; finished (model_finish); 13/21/3; 130 |
| prefix-can-regress | imperfect | resolved; finished (model_finish); 17/25/6; 202 | unresolved; finished (model_finish); 18/19/3; 105 | resolved; finished (model_finish); 19/24/3; 118 |
| prefix-can-regress | unresponsive | unresolved; exhausted (PRODUCER_TEST_LIMIT); 16/24/6; 206 | unresolved; exhausted (limits); 50/34/2; 91 | unresolved; exhausted (limits); 50/36/2; 89 |
| direct-repair | responsive | resolved; finished (model_finish); 5/7/2; 73 | resolved; finished (model_finish); 5/7/2; 73 | resolved; finished (model_finish); 5/7/2; 68 |
| direct-repair | imperfect | resolved; finished (model_finish); 5/7/2; 66 | resolved; finished (model_finish); 5/7/2; 63 | resolved; finished (model_finish); 5/7/2; 68 |
| direct-repair | unresponsive | resolved; finished (model_finish); 5/7/2; 62 | resolved; finished (model_finish); 5/7/2; 68 | resolved; finished (model_finish); 5/7/2; 63 |
| red-baseline-composition | responsive | resolved; finished (model_finish); 15/22/4; 134 | resolved; finished (model_finish); 15/22/4; 146 | resolved; finished (model_finish); 15/22/4; 139 |
| red-baseline-composition | imperfect | unresolved; exhausted (PRODUCER_TEST_LIMIT); 18/27/6; 212 | unresolved; exhausted (PRODUCER_TEST_LIMIT); 18/27/6; 221 | unresolved; exhausted (PRODUCER_TEST_LIMIT); 18/27/6; 222 |
| red-baseline-composition | unresponsive | unresolved; exhausted (PRODUCER_TEST_LIMIT); 14/21/6; 212 | unresolved; exhausted (PRODUCER_TEST_LIMIT); 14/21/6; 213 | unresolved; exhausted (PRODUCER_TEST_LIMIT); 14/21/6; 213 |
| misleading-price-batch | responsive | resolved; finished (model_finish); 11/16/3; 111 | unresolved; finished (model_finish); 12/16/3; 108 | resolved; finished (model_finish); 11/18/3; 111 |
| misleading-price-batch | imperfect | resolved; finished (model_finish); 17/25/6; 211 | unresolved; finished (model_finish); 18/19/3; 111 | resolved; finished (model_finish); 17/21/3; 112 |
| misleading-price-batch | unresponsive | unresolved; exhausted (PRODUCER_TEST_LIMIT); 16/24/6; 200 | unresolved; exhausted (limits); 50/34/2; 84 | resolved; exhausted (limits); 50/36/2; 107 |
| public-test-insufficient | responsive | unresolved; finished (model_finish); 5/7/2; 68 | unresolved; finished (model_finish); 5/7/2; 78 | unresolved; finished (model_finish); 5/7/2; 66 |
| public-test-insufficient | imperfect | unresolved; finished (model_finish); 5/7/2; 64 | unresolved; finished (model_finish); 5/7/2; 65 | unresolved; finished (model_finish); 5/7/2; 71 |
| public-test-insufficient | unresponsive | unresolved; finished (model_finish); 5/7/2; 65 | unresolved; finished (model_finish); 5/7/2; 64 | unresolved; finished (model_finish); 5/7/2; 68 |
| no-feasible-repair | responsive | unresolved; finished (model_finish); 6/8/2; 72 | unresolved; finished (model_finish); 7/10/2; 72 | unresolved; finished (model_finish); 7/10/2; 71 |
| no-feasible-repair | imperfect | unresolved; finished (model_finish); 12/17/5; 162 | unresolved; finished (model_finish); 13/13/2; 73 | unresolved; finished (model_finish); 13/13/2; 79 |
| no-feasible-repair | unresponsive | unresolved; exhausted (PRODUCER_TEST_LIMIT); 14/21/6; 200 | unresolved; exhausted (limits); 50/32/2; 79 | unresolved; exhausted (limits); 50/32/2; 84 |
| test-budget | responsive | unresolved; exhausted (PRODUCER_TEST_LIMIT); 24/36/6; 212 | unresolved; exhausted (PRODUCER_TEST_LIMIT); 24/36/6; 211 | unresolved; exhausted (PRODUCER_TEST_LIMIT); 24/36/6; 229 |
| test-budget | imperfect | unresolved; exhausted (PRODUCER_TEST_LIMIT); 16/24/6; 209 | unresolved; exhausted (PRODUCER_TEST_LIMIT); 16/24/6; 193 | unresolved; exhausted (PRODUCER_TEST_LIMIT); 16/24/6; 208 |
| test-budget | unresponsive | unresolved; exhausted (PRODUCER_TEST_LIMIT); 14/21/6; 210 | unresolved; exhausted (PRODUCER_TEST_LIMIT); 14/21/6; 206 | unresolved; exhausted (PRODUCER_TEST_LIMIT); 14/21/6; 227 |
| independent-verifier-unavailable | responsive | grade failed; finished (model_finish); 5/7/2; 65 | grade failed; finished (model_finish); 5/7/2; 65 | grade failed; finished (model_finish); 5/7/2; 64 |
| independent-verifier-unavailable | imperfect | grade failed; finished (model_finish); 5/7/2; 68 | grade failed; finished (model_finish); 5/7/2; 65 | grade failed; finished (model_finish); 5/7/2; 70 |
| independent-verifier-unavailable | unresponsive | grade failed; finished (model_finish); 5/7/2; 71 | grade failed; finished (model_finish); 5/7/2; 68 | grade failed; finished (model_finish); 5/7/2; 65 |
| authority-interruption | responsive | grade blocked; failed (FIXTURE_AUTHORITY_STOP); 1/2/1; 31 | grade blocked; failed (FIXTURE_AUTHORITY_STOP); 1/2/1; 28 | grade blocked; failed (FIXTURE_AUTHORITY_STOP); 1/2/1; 31 |
| authority-interruption | imperfect | grade blocked; failed (FIXTURE_AUTHORITY_STOP); 1/2/1; 32 | grade blocked; failed (FIXTURE_AUTHORITY_STOP); 1/2/1; 32 | grade blocked; failed (FIXTURE_AUTHORITY_STOP); 1/2/1; 33 |
| authority-interruption | unresponsive | grade blocked; failed (FIXTURE_AUTHORITY_STOP); 1/2/1; 30 | grade blocked; failed (FIXTURE_AUTHORITY_STOP); 1/2/1; 37 | grade blocked; failed (FIXTURE_AUTHORITY_STOP); 1/2/1; 30 |
| uncertain-accounting | responsive | grade blocked; failed (FIXTURE_UNCERTAIN_DISPATCH); 2/2/1; 31 | grade blocked; failed (FIXTURE_UNCERTAIN_DISPATCH); 2/2/1; 29 | grade blocked; failed (FIXTURE_UNCERTAIN_DISPATCH); 2/2/1; 28 |
| uncertain-accounting | imperfect | grade blocked; failed (FIXTURE_UNCERTAIN_DISPATCH); 2/2/1; 31 | grade blocked; failed (FIXTURE_UNCERTAIN_DISPATCH); 2/2/1; 28 | grade blocked; failed (FIXTURE_UNCERTAIN_DISPATCH); 2/2/1; 28 |
| uncertain-accounting | unresponsive | grade blocked; failed (FIXTURE_UNCERTAIN_DISPATCH); 2/2/1; 31 | grade blocked; failed (FIXTURE_UNCERTAIN_DISPATCH); 2/2/1; 29 | grade blocked; failed (FIXTURE_UNCERTAIN_DISPATCH); 2/2/1; 37 |
| scope-escalation | responsive | resolved; finished (model_finish); 13/19/4; 141 | resolved; finished (model_finish); 13/15/4; 136 | resolved; finished (model_finish); 13/15/4; 138 |
| scope-escalation | imperfect | unresolved; exhausted (PRODUCER_TEST_LIMIT); 16/24/6; 202 | resolved; exhausted (PRODUCER_TEST_LIMIT); 26/29/6; 210 | resolved; exhausted (PRODUCER_TEST_LIMIT); 26/29/6; 205 |
| scope-escalation | unresponsive | unresolved; exhausted (PRODUCER_TEST_LIMIT); 14/21/6; 202 | unresolved; exhausted (limits); 50/28/2; 78 | unresolved; exhausted (limits); 50/28/2; 82 |
| single-edit-delay | responsive | resolved; finished (model_finish); 9/13/3; 103 | resolved; finished (model_finish); 9/15/3; 108 | resolved; finished (model_finish); 9/15/3; 103 |
| single-edit-delay | imperfect | resolved; finished (model_finish); 15/22/6; 203 | resolved; finished (model_finish); 15/18/3; 105 | resolved; finished (model_finish); 15/18/3; 121 |
| single-edit-delay | unresponsive | unresolved; exhausted (PRODUCER_TEST_LIMIT); 14/21/6; 207 | unresolved; exhausted (limits); 50/32/2; 84 | unresolved; exhausted (limits); 50/32/2; 87 |
