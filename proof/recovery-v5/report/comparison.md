# Complete policy comparison

2 fixture scenarios; 2 toy program families. Policies and repetitions are sensitivity conditions, not independent tasks. Each cell: grading outcome; producer status; requests/tools/public tests; median producer ms.

| Scenario | Policy | A conventional | B latest PR137 | C experiment |
|---|---|---|---|---|
| uppercase-join | responsive | resolved; finished (model_finish); 11/16/3; 116 | unresolved; finished (model_finish); 12/16/3; 121 | resolved; finished (model_finish); 11/18/3; 117 |
| uppercase-join | imperfect | resolved; finished (model_finish); 17/25/6; 226 | unresolved; finished (model_finish); 18/19/3; 124 | resolved; finished (model_finish); 17/21/3; 123 |
| uppercase-join | unresponsive | unresolved; exhausted (PRODUCER_TEST_LIMIT); 16/24/6; 232 | unresolved; exhausted (limits); 50/34/2; 111 | unresolved; exhausted (limits); 50/36/2; 101 |
| descending-sort | responsive | resolved; finished (model_finish); 11/16/3; 119 | unresolved; finished (model_finish); 12/16/3; 168 | resolved; finished (model_finish); 11/18/3; 168 |
| descending-sort | imperfect | resolved; finished (model_finish); 17/25/6; 295 | unresolved; finished (model_finish); 18/19/3; 140 | resolved; finished (model_finish); 17/21/3; 138 |
| descending-sort | unresponsive | unresolved; exhausted (PRODUCER_TEST_LIMIT); 16/24/6; 263 | unresolved; exhausted (limits); 50/34/2; 103 | unresolved; exhausted (limits); 50/36/2; 104 |
