# Representative traces

Selected events are copied from frozen repetition 0. Complete events and patches remain in results.json.

## intercept-invariant / imperfect / B

```json
{"kind": "public_test", "digest": "5bb579d78c1cda817da5f79ec788e91fffced9440cc98dede96d592f39361c95", "detail": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":0,\"expected\":0,\"passed\":true}]\n", "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "action", "digest": "af062acbe3e64aa039672b0bc0197abeb443bf0cc9685e7d96ea67d18afdb7d7", "detail": {"action": "test"}}
{"kind": "public_test", "digest": "1431a56f879a2b0df4971775294a7929fa3cb5902c67a67c56d39a0f6e388d2b", "detail": {"exitCode": 1, "output": "[{\"input\":0,\"actual\":1,\"expected\":0,\"passed\":false}]\n", "patchDigest": "57dfd9dfdacbe18fd3256795b7314ce5f7308427656423c903547c88a95574ca"}}
{"kind": "failure_memory", "digest": "e5b283b48a1a47b096c7e4d7cb87638d3a497b6ac044319401a974af13d9fb37", "detail": {"candidateDigest": "57dfd9dfdacbe18fd3256795b7314ce5f7308427656423c903547c88a95574ca", "testEvidenceDigest": "1431a56f879a2b0df4971775294a7929fa3cb5902c67a67c56d39a0f6e388d2b", "baselinePassed": true, "contextBoundTactics": ["ce38c496442e4542b67a0f43571d45d90f55628a8a58f6bd054e8ff5a4826850"], "omittedTactics": 0, "contextBoundTransitions": ["dcd94f05aea4a38a5875ed3e6354ccaf1483823f99ce27ad5f1fad08e33998e7"], "omittedTransitions": 0}}
{"kind": "decision", "digest": "9205991c54a1be7624a41aa5dc61e263127fa2038111eb636f6e1a266c8e0465", "detail": {"action": "rollback", "reason": "new_public_failure", "championDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "b191a0e7158b77a58340a6ba52cd21ea209faffad982cdb81142bef0e5499c60", "detail": {"action": "suppress_duplicate", "tactic": "ce38c496442e4542b67a0f43571d45d90f55628a8a58f6bd054e8ff5a4826850"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "b191a0e7158b77a58340a6ba52cd21ea209faffad982cdb81142bef0e5499c60", "detail": {"action": "suppress_duplicate", "tactic": "ce38c496442e4542b67a0f43571d45d90f55628a8a58f6bd054e8ff5a4826850"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "b191a0e7158b77a58340a6ba52cd21ea209faffad982cdb81142bef0e5499c60", "detail": {"action": "suppress_duplicate", "tactic": "ce38c496442e4542b67a0f43571d45d90f55628a8a58f6bd054e8ff5a4826850"}}
{"kind": "action", "digest": "88139ddf8540887ae7f014069ed259e8c5abee2d719df2a6b2dcedac0fed49a5", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"a\": 0", "newText": "\"a\": 1"}}
{"kind": "action", "digest": "af062acbe3e64aa039672b0bc0197abeb443bf0cc9685e7d96ea67d18afdb7d7", "detail": {"action": "test"}}
{"kind": "public_test", "digest": "ff93ac6644fe6d6446449d265b7bea04ade89415e7bcabbff9abd8d6474928ee", "detail": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":0,\"expected\":0,\"passed\":true}]\n", "patchDigest": "0aef085a22bbe02694c04f045300e57c4111ad90f542fb705d83acfc3c8d0aae"}}
{"kind": "decision", "digest": "4cf15dc64a84295a8a5eb27f54320e9894a609d9af33917f645b8b4f3fa56a84", "detail": {"action": "champion", "patchDigest": "0aef085a22bbe02694c04f045300e57c4111ad90f542fb705d83acfc3c8d0aae"}}
{"kind": "action", "digest": "e6eb33a0cb65b8eca0a8d3e1f2e36b594fa9eed3d8d877c3c560b437e9b28e38", "detail": {"action": "finish"}}
{"resolved": true, "gradeStatus": "completed", "freshPublic": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":0,\"expected\":0,\"passed\":true}]\n"}, "privateGrade": {"exitCode": 0, "output": "[{\"input\":2,\"actual\":2,\"expected\":2,\"passed\":true},{\"input\":-1,\"actual\":-1,\"expected\":-1,\"passed\":true}]\n"}, "patchDigest": "0aef085a22bbe02694c04f045300e57c4111ad90f542fb705d83acfc3c8d0aae"}
{"status": "finished", "reason": "model_finish", "modelRequests": 15, "accountingComplete": true, "unreconciledModelRequests": 0}
```

## intercept-invariant / imperfect / C

```json
{"kind": "public_test", "digest": "5bb579d78c1cda817da5f79ec788e91fffced9440cc98dede96d592f39361c95", "detail": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":0,\"expected\":0,\"passed\":true}]\n", "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "action", "digest": "af062acbe3e64aa039672b0bc0197abeb443bf0cc9685e7d96ea67d18afdb7d7", "detail": {"action": "test"}}
{"kind": "public_test", "digest": "1431a56f879a2b0df4971775294a7929fa3cb5902c67a67c56d39a0f6e388d2b", "detail": {"exitCode": 1, "output": "[{\"input\":0,\"actual\":1,\"expected\":0,\"passed\":false}]\n", "patchDigest": "57dfd9dfdacbe18fd3256795b7314ce5f7308427656423c903547c88a95574ca"}}
{"kind": "failure_memory", "digest": "e5b283b48a1a47b096c7e4d7cb87638d3a497b6ac044319401a974af13d9fb37", "detail": {"candidateDigest": "57dfd9dfdacbe18fd3256795b7314ce5f7308427656423c903547c88a95574ca", "testEvidenceDigest": "1431a56f879a2b0df4971775294a7929fa3cb5902c67a67c56d39a0f6e388d2b", "baselinePassed": true, "contextBoundTactics": ["ce38c496442e4542b67a0f43571d45d90f55628a8a58f6bd054e8ff5a4826850"], "omittedTactics": 0, "contextBoundTransitions": ["dcd94f05aea4a38a5875ed3e6354ccaf1483823f99ce27ad5f1fad08e33998e7"], "omittedTransitions": 0}}
{"kind": "decision", "digest": "9205991c54a1be7624a41aa5dc61e263127fa2038111eb636f6e1a266c8e0465", "detail": {"action": "rollback", "reason": "new_public_failure", "championDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "4a96dfd912b1e18b20c90dda05b2c62a760654e980b0887874b3963fd9b7a69c", "detail": {"action": "suppress_duplicate", "tactic": "ce38c496442e4542b67a0f43571d45d90f55628a8a58f6bd054e8ff5a4826850", "rejections": 1}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "38b6cad3195979d664082b4d1261f3581a6d8be7384f59e541dfb94730e432d9", "detail": {"action": "suppress_duplicate", "tactic": "ce38c496442e4542b67a0f43571d45d90f55628a8a58f6bd054e8ff5a4826850", "rejections": 2}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "e9223a0c9d79b2bccb5fa33b796ad6d43242fda9244a6a38e54052ddb3e92717", "detail": {"action": "suppress_duplicate", "tactic": "ce38c496442e4542b67a0f43571d45d90f55628a8a58f6bd054e8ff5a4826850", "rejections": 3}}
{"kind": "stopped", "digest": "31d0d78209f4e1193dfb72611b8af3b03a01fab00fc11ebdd2607c4af8f00715", "detail": {"reason": "PRODUCER_REPEATED_FAILED_EDIT"}}
{"resolved": false, "gradeStatus": "completed", "freshPublic": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":0,\"expected\":0,\"passed\":true}]\n"}, "privateGrade": {"exitCode": 1, "output": "[{\"input\":2,\"actual\":0,\"expected\":2,\"passed\":false},{\"input\":-1,\"actual\":0,\"expected\":-1,\"passed\":false}]\n"}, "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}
{"status": "failed", "reason": "PRODUCER_REPEATED_FAILED_EDIT", "modelRequests": 10, "accountingComplete": true, "unreconciledModelRequests": 0}
```

## intercept-invariant / unresponsive / B

```json
{"kind": "public_test", "digest": "5bb579d78c1cda817da5f79ec788e91fffced9440cc98dede96d592f39361c95", "detail": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":0,\"expected\":0,\"passed\":true}]\n", "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "action", "digest": "af062acbe3e64aa039672b0bc0197abeb443bf0cc9685e7d96ea67d18afdb7d7", "detail": {"action": "test"}}
{"kind": "public_test", "digest": "1431a56f879a2b0df4971775294a7929fa3cb5902c67a67c56d39a0f6e388d2b", "detail": {"exitCode": 1, "output": "[{\"input\":0,\"actual\":1,\"expected\":0,\"passed\":false}]\n", "patchDigest": "57dfd9dfdacbe18fd3256795b7314ce5f7308427656423c903547c88a95574ca"}}
{"kind": "failure_memory", "digest": "e5b283b48a1a47b096c7e4d7cb87638d3a497b6ac044319401a974af13d9fb37", "detail": {"candidateDigest": "57dfd9dfdacbe18fd3256795b7314ce5f7308427656423c903547c88a95574ca", "testEvidenceDigest": "1431a56f879a2b0df4971775294a7929fa3cb5902c67a67c56d39a0f6e388d2b", "baselinePassed": true, "contextBoundTactics": ["ce38c496442e4542b67a0f43571d45d90f55628a8a58f6bd054e8ff5a4826850"], "omittedTactics": 0, "contextBoundTransitions": ["dcd94f05aea4a38a5875ed3e6354ccaf1483823f99ce27ad5f1fad08e33998e7"], "omittedTransitions": 0}}
{"kind": "decision", "digest": "9205991c54a1be7624a41aa5dc61e263127fa2038111eb636f6e1a266c8e0465", "detail": {"action": "rollback", "reason": "new_public_failure", "championDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "b191a0e7158b77a58340a6ba52cd21ea209faffad982cdb81142bef0e5499c60", "detail": {"action": "suppress_duplicate", "tactic": "ce38c496442e4542b67a0f43571d45d90f55628a8a58f6bd054e8ff5a4826850"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "b191a0e7158b77a58340a6ba52cd21ea209faffad982cdb81142bef0e5499c60", "detail": {"action": "suppress_duplicate", "tactic": "ce38c496442e4542b67a0f43571d45d90f55628a8a58f6bd054e8ff5a4826850"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "b191a0e7158b77a58340a6ba52cd21ea209faffad982cdb81142bef0e5499c60", "detail": {"action": "suppress_duplicate", "tactic": "ce38c496442e4542b67a0f43571d45d90f55628a8a58f6bd054e8ff5a4826850"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "b191a0e7158b77a58340a6ba52cd21ea209faffad982cdb81142bef0e5499c60", "detail": {"action": "suppress_duplicate", "tactic": "ce38c496442e4542b67a0f43571d45d90f55628a8a58f6bd054e8ff5a4826850"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "b191a0e7158b77a58340a6ba52cd21ea209faffad982cdb81142bef0e5499c60", "detail": {"action": "suppress_duplicate", "tactic": "ce38c496442e4542b67a0f43571d45d90f55628a8a58f6bd054e8ff5a4826850"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "b191a0e7158b77a58340a6ba52cd21ea209faffad982cdb81142bef0e5499c60", "detail": {"action": "suppress_duplicate", "tactic": "ce38c496442e4542b67a0f43571d45d90f55628a8a58f6bd054e8ff5a4826850"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "b191a0e7158b77a58340a6ba52cd21ea209faffad982cdb81142bef0e5499c60", "detail": {"action": "suppress_duplicate", "tactic": "ce38c496442e4542b67a0f43571d45d90f55628a8a58f6bd054e8ff5a4826850"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "b191a0e7158b77a58340a6ba52cd21ea209faffad982cdb81142bef0e5499c60", "detail": {"action": "suppress_duplicate", "tactic": "ce38c496442e4542b67a0f43571d45d90f55628a8a58f6bd054e8ff5a4826850"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "b191a0e7158b77a58340a6ba52cd21ea209faffad982cdb81142bef0e5499c60", "detail": {"action": "suppress_duplicate", "tactic": "ce38c496442e4542b67a0f43571d45d90f55628a8a58f6bd054e8ff5a4826850"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "b191a0e7158b77a58340a6ba52cd21ea209faffad982cdb81142bef0e5499c60", "detail": {"action": "suppress_duplicate", "tactic": "ce38c496442e4542b67a0f43571d45d90f55628a8a58f6bd054e8ff5a4826850"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "b191a0e7158b77a58340a6ba52cd21ea209faffad982cdb81142bef0e5499c60", "detail": {"action": "suppress_duplicate", "tactic": "ce38c496442e4542b67a0f43571d45d90f55628a8a58f6bd054e8ff5a4826850"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "b191a0e7158b77a58340a6ba52cd21ea209faffad982cdb81142bef0e5499c60", "detail": {"action": "suppress_duplicate", "tactic": "ce38c496442e4542b67a0f43571d45d90f55628a8a58f6bd054e8ff5a4826850"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "b191a0e7158b77a58340a6ba52cd21ea209faffad982cdb81142bef0e5499c60", "detail": {"action": "suppress_duplicate", "tactic": "ce38c496442e4542b67a0f43571d45d90f55628a8a58f6bd054e8ff5a4826850"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "b191a0e7158b77a58340a6ba52cd21ea209faffad982cdb81142bef0e5499c60", "detail": {"action": "suppress_duplicate", "tactic": "ce38c496442e4542b67a0f43571d45d90f55628a8a58f6bd054e8ff5a4826850"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "b191a0e7158b77a58340a6ba52cd21ea209faffad982cdb81142bef0e5499c60", "detail": {"action": "suppress_duplicate", "tactic": "ce38c496442e4542b67a0f43571d45d90f55628a8a58f6bd054e8ff5a4826850"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "b191a0e7158b77a58340a6ba52cd21ea209faffad982cdb81142bef0e5499c60", "detail": {"action": "suppress_duplicate", "tactic": "ce38c496442e4542b67a0f43571d45d90f55628a8a58f6bd054e8ff5a4826850"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "b191a0e7158b77a58340a6ba52cd21ea209faffad982cdb81142bef0e5499c60", "detail": {"action": "suppress_duplicate", "tactic": "ce38c496442e4542b67a0f43571d45d90f55628a8a58f6bd054e8ff5a4826850"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "b191a0e7158b77a58340a6ba52cd21ea209faffad982cdb81142bef0e5499c60", "detail": {"action": "suppress_duplicate", "tactic": "ce38c496442e4542b67a0f43571d45d90f55628a8a58f6bd054e8ff5a4826850"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "b191a0e7158b77a58340a6ba52cd21ea209faffad982cdb81142bef0e5499c60", "detail": {"action": "suppress_duplicate", "tactic": "ce38c496442e4542b67a0f43571d45d90f55628a8a58f6bd054e8ff5a4826850"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "b191a0e7158b77a58340a6ba52cd21ea209faffad982cdb81142bef0e5499c60", "detail": {"action": "suppress_duplicate", "tactic": "ce38c496442e4542b67a0f43571d45d90f55628a8a58f6bd054e8ff5a4826850"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "b191a0e7158b77a58340a6ba52cd21ea209faffad982cdb81142bef0e5499c60", "detail": {"action": "suppress_duplicate", "tactic": "ce38c496442e4542b67a0f43571d45d90f55628a8a58f6bd054e8ff5a4826850"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "b191a0e7158b77a58340a6ba52cd21ea209faffad982cdb81142bef0e5499c60", "detail": {"action": "suppress_duplicate", "tactic": "ce38c496442e4542b67a0f43571d45d90f55628a8a58f6bd054e8ff5a4826850"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "b191a0e7158b77a58340a6ba52cd21ea209faffad982cdb81142bef0e5499c60", "detail": {"action": "suppress_duplicate", "tactic": "ce38c496442e4542b67a0f43571d45d90f55628a8a58f6bd054e8ff5a4826850"}}
{"resolved": false, "gradeStatus": "completed", "freshPublic": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":0,\"expected\":0,\"passed\":true}]\n"}, "privateGrade": {"exitCode": 1, "output": "[{\"input\":2,\"actual\":0,\"expected\":2,\"passed\":false},{\"input\":-1,\"actual\":0,\"expected\":-1,\"passed\":false}]\n"}, "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}
{"status": "exhausted", "reason": "limits", "modelRequests": 50, "accountingComplete": true, "unreconciledModelRequests": 0}
```

## intercept-invariant / unresponsive / C

```json
{"kind": "public_test", "digest": "5bb579d78c1cda817da5f79ec788e91fffced9440cc98dede96d592f39361c95", "detail": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":0,\"expected\":0,\"passed\":true}]\n", "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "action", "digest": "af062acbe3e64aa039672b0bc0197abeb443bf0cc9685e7d96ea67d18afdb7d7", "detail": {"action": "test"}}
{"kind": "public_test", "digest": "1431a56f879a2b0df4971775294a7929fa3cb5902c67a67c56d39a0f6e388d2b", "detail": {"exitCode": 1, "output": "[{\"input\":0,\"actual\":1,\"expected\":0,\"passed\":false}]\n", "patchDigest": "57dfd9dfdacbe18fd3256795b7314ce5f7308427656423c903547c88a95574ca"}}
{"kind": "failure_memory", "digest": "e5b283b48a1a47b096c7e4d7cb87638d3a497b6ac044319401a974af13d9fb37", "detail": {"candidateDigest": "57dfd9dfdacbe18fd3256795b7314ce5f7308427656423c903547c88a95574ca", "testEvidenceDigest": "1431a56f879a2b0df4971775294a7929fa3cb5902c67a67c56d39a0f6e388d2b", "baselinePassed": true, "contextBoundTactics": ["ce38c496442e4542b67a0f43571d45d90f55628a8a58f6bd054e8ff5a4826850"], "omittedTactics": 0, "contextBoundTransitions": ["dcd94f05aea4a38a5875ed3e6354ccaf1483823f99ce27ad5f1fad08e33998e7"], "omittedTransitions": 0}}
{"kind": "decision", "digest": "9205991c54a1be7624a41aa5dc61e263127fa2038111eb636f6e1a266c8e0465", "detail": {"action": "rollback", "reason": "new_public_failure", "championDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "4a96dfd912b1e18b20c90dda05b2c62a760654e980b0887874b3963fd9b7a69c", "detail": {"action": "suppress_duplicate", "tactic": "ce38c496442e4542b67a0f43571d45d90f55628a8a58f6bd054e8ff5a4826850", "rejections": 1}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "38b6cad3195979d664082b4d1261f3581a6d8be7384f59e541dfb94730e432d9", "detail": {"action": "suppress_duplicate", "tactic": "ce38c496442e4542b67a0f43571d45d90f55628a8a58f6bd054e8ff5a4826850", "rejections": 2}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "e9223a0c9d79b2bccb5fa33b796ad6d43242fda9244a6a38e54052ddb3e92717", "detail": {"action": "suppress_duplicate", "tactic": "ce38c496442e4542b67a0f43571d45d90f55628a8a58f6bd054e8ff5a4826850", "rejections": 3}}
{"kind": "stopped", "digest": "31d0d78209f4e1193dfb72611b8af3b03a01fab00fc11ebdd2607c4af8f00715", "detail": {"reason": "PRODUCER_REPEATED_FAILED_EDIT"}}
{"resolved": false, "gradeStatus": "completed", "freshPublic": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":0,\"expected\":0,\"passed\":true}]\n"}, "privateGrade": {"exitCode": 1, "output": "[{\"input\":2,\"actual\":0,\"expected\":2,\"passed\":false},{\"input\":-1,\"actual\":0,\"expected\":-1,\"passed\":false}]\n"}, "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}
{"status": "failed", "reason": "PRODUCER_REPEATED_FAILED_EDIT", "modelRequests": 10, "accountingComplete": true, "unreconciledModelRequests": 0}
```

## upper-bound-invariant / responsive / C

```json
{"kind": "public_test", "digest": "30089f5ace98f6fb02216b1b4ef66df1ea7fede42fff4459e6d51a5c37ebbf7d", "detail": {"exitCode": 0, "output": "[{\"input\":20,\"actual\":10,\"expected\":10,\"passed\":true}]\n", "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}}
{"kind": "action", "digest": "8eae69b72e9e02381d8d6bb12b3dda7efba24c06955e6445bd687490ed161055", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"hi\": 10", "newText": "\"hi\": 8"}}
{"kind": "action", "digest": "af062acbe3e64aa039672b0bc0197abeb443bf0cc9685e7d96ea67d18afdb7d7", "detail": {"action": "test"}}
{"kind": "public_test", "digest": "a5f0ddcb567ef7a6263dd0a921bbfc8e84b4b961378b3e65fc0c45d3694727f1", "detail": {"exitCode": 1, "output": "[{\"input\":20,\"actual\":8,\"expected\":10,\"passed\":false}]\n", "patchDigest": "d31d9b1781d96a9d5582b8ec88ffa3dacfff2d484dbd645f4e3389df7f8ddf54"}}
{"kind": "failure_memory", "digest": "3cacee913538c54a96ad33dac77b35be5ab49b881c0947432f94b4039ffbc3b2", "detail": {"candidateDigest": "d31d9b1781d96a9d5582b8ec88ffa3dacfff2d484dbd645f4e3389df7f8ddf54", "testEvidenceDigest": "a5f0ddcb567ef7a6263dd0a921bbfc8e84b4b961378b3e65fc0c45d3694727f1", "baselinePassed": true, "contextBoundTactics": ["49e1105f6551ac4f47a2b7d86caf7ec5f6548264c5a3a1dee7e859e395435f8c"], "omittedTactics": 0, "contextBoundTransitions": ["5c426f54d361849d37fe46b921844d975862101bf721b413a67daa1fad83caf8"], "omittedTransitions": 0}}
{"kind": "decision", "digest": "9205991c54a1be7624a41aa5dc61e263127fa2038111eb636f6e1a266c8e0465", "detail": {"action": "rollback", "reason": "new_public_failure", "championDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}}
{"kind": "action", "digest": "c77fc2d7b4ee58c4c3a2ef9e683056513bc2c965619f778ad24bf0a0ff4586e9", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"lo\": 0", "newText": "\"lo\": 2"}}
{"kind": "action", "digest": "af062acbe3e64aa039672b0bc0197abeb443bf0cc9685e7d96ea67d18afdb7d7", "detail": {"action": "test"}}
{"kind": "public_test", "digest": "28ad50b97e396af9f18e56a4f09baa713b6684cf76d23d80bff00423bd7d09d6", "detail": {"exitCode": 0, "output": "[{\"input\":20,\"actual\":10,\"expected\":10,\"passed\":true}]\n", "patchDigest": "311c91fdb717088c75a23b269ebbd43bb12a6b0780cc78a6b304cdc1ad50d6a4"}}
{"kind": "decision", "digest": "811529ccd35195cc787d21295a3e894c47513e4f966a8eb0a86040c4fd924299", "detail": {"action": "champion", "patchDigest": "311c91fdb717088c75a23b269ebbd43bb12a6b0780cc78a6b304cdc1ad50d6a4"}}
{"kind": "action", "digest": "e6eb33a0cb65b8eca0a8d3e1f2e36b594fa9eed3d8d877c3c560b437e9b28e38", "detail": {"action": "finish"}}
{"resolved": true, "gradeStatus": "completed", "freshPublic": {"exitCode": 0, "output": "[{\"input\":20,\"actual\":10,\"expected\":10,\"passed\":true}]\n"}, "privateGrade": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":2,\"expected\":2,\"passed\":true},{\"input\":5,\"actual\":5,\"expected\":5,\"passed\":true}]\n"}, "patchDigest": "311c91fdb717088c75a23b269ebbd43bb12a6b0780cc78a6b304cdc1ad50d6a4"}
{"status": "finished", "reason": "model_finish", "modelRequests": 9, "accountingComplete": true, "unreconciledModelRequests": 0}
```

## uncertain-dispatch / responsive / C

```json
{"kind": "public_test", "digest": "0d7edec76ecaedc9d7f56239c92ffa789b7aceba16f5d88a9971e20a1b7a3ecf", "detail": {"exitCode": 1, "output": "[{\"input\":0,\"actual\":0,\"expected\":2,\"passed\":false}]\n", "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}}
{"kind": "stopped", "digest": "b20b095b20077ec6888bcc8ad73e870e273f6ac48cadc35ef7a4b5193c1262ec", "detail": {"reason": "FIXTURE_UNCERTAIN_DISPATCH"}}
{"resolved": false, "gradeStatus": "blocked", "freshPublic": null, "privateGrade": null, "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}
{"status": "failed", "reason": "FIXTURE_UNCERTAIN_DISPATCH", "modelRequests": 2, "accountingComplete": false, "unreconciledModelRequests": 1}
```
