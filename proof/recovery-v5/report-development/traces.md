# Representative traces

Copied from frozen producer outcomes; grading occurs afterward.

## prefix-can-regress / unresponsive / C

```json
{"kind": "public_test", "digest": "3e47c2fa7104977ac3d0ee7d3016f225b9cfac626fe6546fbf0f293b5ddfdf74", "detail": {"exitCode": 0, "output": "[{\"input\":1,\"actual\":0,\"expected\":0,\"passed\":true}]\n", "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}}
{"kind": "action", "digest": "fb8193ad0968195e4f4d9ab9271567685c84c66f05c0122364da6ff3afe14f2a", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"a\": 0", "newText": "\"a\": 2"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "action", "digest": "af062acbe3e64aa039672b0bc0197abeb443bf0cc9685e7d96ea67d18afdb7d7", "detail": {"action": "test"}}
{"kind": "public_test", "digest": "eefb75a9f4e17f7f5a50318d69e0851ba6d55a3f55d5c8dd9c33f7fc5d4864db", "detail": {"exitCode": 1, "output": "[{\"input\":1,\"actual\":3,\"expected\":0,\"passed\":false}]\n", "patchDigest": "ae6d529148ff5fdd744e0ecd39d6db9b168efa5705e5e2544c13b9c80c5718e9"}}
{"kind": "failure_memory", "digest": "9a2338b832c34b4ba92af5981a7cd6c87ba1f65767d5a76c694bd4f4799d7e0a", "detail": {"candidateDigest": "ae6d529148ff5fdd744e0ecd39d6db9b168efa5705e5e2544c13b9c80c5718e9", "testEvidenceDigest": "eefb75a9f4e17f7f5a50318d69e0851ba6d55a3f55d5c8dd9c33f7fc5d4864db", "baselinePassed": true, "attribution": "tested_terminal_transition", "contextBoundTactics": ["bac6d6c3db9cb5c17d54d6deafbf3feae79084760e8ebfa498e989e410494b30"], "omittedTactics": 0, "contextBoundTransitions": ["4096cf87023deb978f4f5464691db99868622d0430ce4b5395228daa7ebd3bf2"], "omittedTransitions": 0, "untestedIntermediateTactics": ["a375d7447174ed3e216dafe3ccfeff6a0d98229ae5e3b3a273c9116e738e3ebb"], "omittedIntermediateTactics": 0}}
{"kind": "decision", "digest": "9205991c54a1be7624a41aa5dc61e263127fa2038111eb636f6e1a266c8e0465", "detail": {"action": "rollback", "reason": "new_public_failure", "championDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}}
{"kind": "action", "digest": "fb8193ad0968195e4f4d9ab9271567685c84c66f05c0122364da6ff3afe14f2a", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"a\": 0", "newText": "\"a\": 2"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "695fa501311fc60b4e924386f1da54d2b25733d4a90a7cdd51b3ac0a00ea8819", "detail": {"action": "suppress_duplicate", "tactic": "bac6d6c3db9cb5c17d54d6deafbf3feae79084760e8ebfa498e989e410494b30"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "695fa501311fc60b4e924386f1da54d2b25733d4a90a7cdd51b3ac0a00ea8819", "detail": {"action": "suppress_duplicate", "tactic": "bac6d6c3db9cb5c17d54d6deafbf3feae79084760e8ebfa498e989e410494b30"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "695fa501311fc60b4e924386f1da54d2b25733d4a90a7cdd51b3ac0a00ea8819", "detail": {"action": "suppress_duplicate", "tactic": "bac6d6c3db9cb5c17d54d6deafbf3feae79084760e8ebfa498e989e410494b30"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "695fa501311fc60b4e924386f1da54d2b25733d4a90a7cdd51b3ac0a00ea8819", "detail": {"action": "suppress_duplicate", "tactic": "bac6d6c3db9cb5c17d54d6deafbf3feae79084760e8ebfa498e989e410494b30"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "695fa501311fc60b4e924386f1da54d2b25733d4a90a7cdd51b3ac0a00ea8819", "detail": {"action": "suppress_duplicate", "tactic": "bac6d6c3db9cb5c17d54d6deafbf3feae79084760e8ebfa498e989e410494b30"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "695fa501311fc60b4e924386f1da54d2b25733d4a90a7cdd51b3ac0a00ea8819", "detail": {"action": "suppress_duplicate", "tactic": "bac6d6c3db9cb5c17d54d6deafbf3feae79084760e8ebfa498e989e410494b30"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "695fa501311fc60b4e924386f1da54d2b25733d4a90a7cdd51b3ac0a00ea8819", "detail": {"action": "suppress_duplicate", "tactic": "bac6d6c3db9cb5c17d54d6deafbf3feae79084760e8ebfa498e989e410494b30"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "695fa501311fc60b4e924386f1da54d2b25733d4a90a7cdd51b3ac0a00ea8819", "detail": {"action": "suppress_duplicate", "tactic": "bac6d6c3db9cb5c17d54d6deafbf3feae79084760e8ebfa498e989e410494b30"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "695fa501311fc60b4e924386f1da54d2b25733d4a90a7cdd51b3ac0a00ea8819", "detail": {"action": "suppress_duplicate", "tactic": "bac6d6c3db9cb5c17d54d6deafbf3feae79084760e8ebfa498e989e410494b30"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "695fa501311fc60b4e924386f1da54d2b25733d4a90a7cdd51b3ac0a00ea8819", "detail": {"action": "suppress_duplicate", "tactic": "bac6d6c3db9cb5c17d54d6deafbf3feae79084760e8ebfa498e989e410494b30"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "695fa501311fc60b4e924386f1da54d2b25733d4a90a7cdd51b3ac0a00ea8819", "detail": {"action": "suppress_duplicate", "tactic": "bac6d6c3db9cb5c17d54d6deafbf3feae79084760e8ebfa498e989e410494b30"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "695fa501311fc60b4e924386f1da54d2b25733d4a90a7cdd51b3ac0a00ea8819", "detail": {"action": "suppress_duplicate", "tactic": "bac6d6c3db9cb5c17d54d6deafbf3feae79084760e8ebfa498e989e410494b30"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "695fa501311fc60b4e924386f1da54d2b25733d4a90a7cdd51b3ac0a00ea8819", "detail": {"action": "suppress_duplicate", "tactic": "bac6d6c3db9cb5c17d54d6deafbf3feae79084760e8ebfa498e989e410494b30"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "695fa501311fc60b4e924386f1da54d2b25733d4a90a7cdd51b3ac0a00ea8819", "detail": {"action": "suppress_duplicate", "tactic": "bac6d6c3db9cb5c17d54d6deafbf3feae79084760e8ebfa498e989e410494b30"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "695fa501311fc60b4e924386f1da54d2b25733d4a90a7cdd51b3ac0a00ea8819", "detail": {"action": "suppress_duplicate", "tactic": "bac6d6c3db9cb5c17d54d6deafbf3feae79084760e8ebfa498e989e410494b30"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "695fa501311fc60b4e924386f1da54d2b25733d4a90a7cdd51b3ac0a00ea8819", "detail": {"action": "suppress_duplicate", "tactic": "bac6d6c3db9cb5c17d54d6deafbf3feae79084760e8ebfa498e989e410494b30"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "695fa501311fc60b4e924386f1da54d2b25733d4a90a7cdd51b3ac0a00ea8819", "detail": {"action": "suppress_duplicate", "tactic": "bac6d6c3db9cb5c17d54d6deafbf3feae79084760e8ebfa498e989e410494b30"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "695fa501311fc60b4e924386f1da54d2b25733d4a90a7cdd51b3ac0a00ea8819", "detail": {"action": "suppress_duplicate", "tactic": "bac6d6c3db9cb5c17d54d6deafbf3feae79084760e8ebfa498e989e410494b30"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "695fa501311fc60b4e924386f1da54d2b25733d4a90a7cdd51b3ac0a00ea8819", "detail": {"action": "suppress_duplicate", "tactic": "bac6d6c3db9cb5c17d54d6deafbf3feae79084760e8ebfa498e989e410494b30"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "695fa501311fc60b4e924386f1da54d2b25733d4a90a7cdd51b3ac0a00ea8819", "detail": {"action": "suppress_duplicate", "tactic": "bac6d6c3db9cb5c17d54d6deafbf3feae79084760e8ebfa498e989e410494b30"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "decision", "digest": "695fa501311fc60b4e924386f1da54d2b25733d4a90a7cdd51b3ac0a00ea8819", "detail": {"action": "suppress_duplicate", "tactic": "bac6d6c3db9cb5c17d54d6deafbf3feae79084760e8ebfa498e989e410494b30"}}
{"kind": "decision", "digest": "e993d2120b61e34abc34a18c26124a1a092ff47296869dcdfe58158fd679f545", "detail": {"action": "retain_verified_champion", "discardedPatchDigest": "b630dc8480483919126eaf446376973e3e6977d96ab60e049b3dad73a1a74db7", "championDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "reason": "termination_with_unverified_candidate"}}
{"resolved": false, "regression": false, "gradeStatus": "completed", "freshPublic": {"exitCode": 0, "output": "[{\"input\":1,\"actual\":0,\"expected\":0,\"passed\":true}]\n"}, "privateGrade": {"exitCode": 1, "output": "[{\"input\":0,\"actual\":0,\"expected\":-2,\"passed\":false},{\"input\":3,\"actual\":0,\"expected\":4,\"passed\":false}]\n"}, "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "partialProgress": {"alignedStates": 4, "lossTransitions": 1, "reusedAfterLoss": 1, "finalAligned": false, "meaning": "requirement-aligned fields, assessed after freeze; not independently verified intermediate repair"}}
```

## scale-batch / imperfect / C

```json
{"kind": "public_test", "digest": "5bb579d78c1cda817da5f79ec788e91fffced9440cc98dede96d592f39361c95", "detail": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":0,\"expected\":0,\"passed\":true}]\n", "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}}
{"kind": "action", "digest": "64c5ab1a7707cc9a854431bedd61061f7855a18d0866e8c94b7209a94f3f4730", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"a\": 0", "newText": "\"a\": 3"}}
{"kind": "action", "digest": "8a903a96efd7f8ad96256982ec33de2415e7490894d9acd5d31ec2f9573542b2", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 2"}}
{"kind": "action", "digest": "af062acbe3e64aa039672b0bc0197abeb443bf0cc9685e7d96ea67d18afdb7d7", "detail": {"action": "test"}}
{"kind": "public_test", "digest": "0ba07949371377af233c39008f7ee4a08187ded052048d6e90a45a33a361822e", "detail": {"exitCode": 1, "output": "[{\"input\":0,\"actual\":2,\"expected\":0,\"passed\":false}]\n", "patchDigest": "65c990c7494fa2ecf73a34b0d8b242ad52394babf6d439da912f29a541aa4ad7"}}
{"kind": "failure_memory", "digest": "1816696cd564362d2b8f25f5492b855bb853ab685c265ebf1d00b476cde4049c", "detail": {"candidateDigest": "65c990c7494fa2ecf73a34b0d8b242ad52394babf6d439da912f29a541aa4ad7", "testEvidenceDigest": "0ba07949371377af233c39008f7ee4a08187ded052048d6e90a45a33a361822e", "baselinePassed": true, "attribution": "tested_terminal_transition", "contextBoundTactics": ["702952fe0ea2cf79ebc6fbcd1bc4dd976c936a026ec6c58106ef32c9878ed359"], "omittedTactics": 0, "contextBoundTransitions": ["5118f60a2679b58f7d4ffccf57caaa3529965b86de83f5c63ea0e31b04bf735c"], "omittedTransitions": 0, "untestedIntermediateTactics": ["861edbda8123cd56f00dcedf1e98cd06325e11d242df61b3f86551a2a6df0b36"], "omittedIntermediateTactics": 0}}
{"kind": "decision", "digest": "9205991c54a1be7624a41aa5dc61e263127fa2038111eb636f6e1a266c8e0465", "detail": {"action": "rollback", "reason": "new_public_failure", "championDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}}
{"kind": "action", "digest": "64c5ab1a7707cc9a854431bedd61061f7855a18d0866e8c94b7209a94f3f4730", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"a\": 0", "newText": "\"a\": 3"}}
{"kind": "action", "digest": "8a903a96efd7f8ad96256982ec33de2415e7490894d9acd5d31ec2f9573542b2", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 2"}}
{"kind": "decision", "digest": "aa439176870dafaf76d6ff34ba5fdd325e69a2a17621d11227de3b31fde87334", "detail": {"action": "suppress_duplicate", "tactic": "702952fe0ea2cf79ebc6fbcd1bc4dd976c936a026ec6c58106ef32c9878ed359"}}
{"kind": "action", "digest": "8a903a96efd7f8ad96256982ec33de2415e7490894d9acd5d31ec2f9573542b2", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 2"}}
{"kind": "decision", "digest": "aa439176870dafaf76d6ff34ba5fdd325e69a2a17621d11227de3b31fde87334", "detail": {"action": "suppress_duplicate", "tactic": "702952fe0ea2cf79ebc6fbcd1bc4dd976c936a026ec6c58106ef32c9878ed359"}}
{"kind": "action", "digest": "8a903a96efd7f8ad96256982ec33de2415e7490894d9acd5d31ec2f9573542b2", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 2"}}
{"kind": "decision", "digest": "aa439176870dafaf76d6ff34ba5fdd325e69a2a17621d11227de3b31fde87334", "detail": {"action": "suppress_duplicate", "tactic": "702952fe0ea2cf79ebc6fbcd1bc4dd976c936a026ec6c58106ef32c9878ed359"}}
{"kind": "action", "digest": "af062acbe3e64aa039672b0bc0197abeb443bf0cc9685e7d96ea67d18afdb7d7", "detail": {"action": "test"}}
{"kind": "public_test", "digest": "73d15e8c8938c7f782a23a5f1c402f8cbfdcef290ad880eeb5367929aa4c9f14", "detail": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":0,\"expected\":0,\"passed\":true}]\n", "patchDigest": "21f992c14c1a879271582192643235ae9d553f34ce2f08bd1de6c30bc6dbe9ec"}}
{"kind": "decision", "digest": "32939ab789171fbb73a69221bb8c9cff869cabde9951ba26e3132499cac198a9", "detail": {"action": "champion", "patchDigest": "21f992c14c1a879271582192643235ae9d553f34ce2f08bd1de6c30bc6dbe9ec"}}
{"kind": "action", "digest": "e6eb33a0cb65b8eca0a8d3e1f2e36b594fa9eed3d8d877c3c560b437e9b28e38", "detail": {"action": "finish"}}
{"resolved": true, "regression": false, "gradeStatus": "completed", "freshPublic": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":0,\"expected\":0,\"passed\":true}]\n"}, "privateGrade": {"exitCode": 0, "output": "[{\"input\":4,\"actual\":12,\"expected\":12,\"passed\":true},{\"input\":-2,\"actual\":-6,\"expected\":-6,\"passed\":true}]\n"}, "patchDigest": "21f992c14c1a879271582192643235ae9d553f34ce2f08bd1de6c30bc6dbe9ec", "partialProgress": {"alignedStates": 5, "lossTransitions": 1, "reusedAfterLoss": 1, "finalAligned": true, "meaning": "requirement-aligned fields, assessed after freeze; not independently verified intermediate repair"}}
```

## uncertain-accounting / responsive / C

```json
{"kind": "public_test", "digest": "0d7edec76ecaedc9d7f56239c92ffa789b7aceba16f5d88a9971e20a1b7a3ecf", "detail": {"exitCode": 1, "output": "[{\"input\":0,\"actual\":0,\"expected\":2,\"passed\":false}]\n", "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}}
{"kind": "stopped", "digest": "b20b095b20077ec6888bcc8ad73e870e273f6ac48cadc35ef7a4b5193c1262ec", "detail": {"reason": "FIXTURE_UNCERTAIN_DISPATCH"}}
{"resolved": false, "regression": null, "gradeStatus": "blocked", "freshPublic": null, "privateGrade": null, "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "partialProgress": null}
```
