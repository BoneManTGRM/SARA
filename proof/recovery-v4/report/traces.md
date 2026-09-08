# Representative traces

Selected events copied from frozen repetition 0. Complete events, digests and patches remain in results.json.

## scale-batch / imperfect / B

```json
{"kind": "public_test", "digest": "5bb579d78c1cda817da5f79ec788e91fffced9440cc98dede96d592f39361c95", "detail": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":0,\"expected\":0,\"passed\":true}]\n", "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}}
{"kind": "action", "digest": "64c5ab1a7707cc9a854431bedd61061f7855a18d0866e8c94b7209a94f3f4730", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"a\": 0", "newText": "\"a\": 3"}}
{"kind": "action", "digest": "8a903a96efd7f8ad96256982ec33de2415e7490894d9acd5d31ec2f9573542b2", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 2"}}
{"kind": "action", "digest": "af062acbe3e64aa039672b0bc0197abeb443bf0cc9685e7d96ea67d18afdb7d7", "detail": {"action": "test"}}
{"kind": "public_test", "digest": "0ba07949371377af233c39008f7ee4a08187ded052048d6e90a45a33a361822e", "detail": {"exitCode": 1, "output": "[{\"input\":0,\"actual\":2,\"expected\":0,\"passed\":false}]\n", "patchDigest": "65c990c7494fa2ecf73a34b0d8b242ad52394babf6d439da912f29a541aa4ad7"}}
{"kind": "failure_memory", "digest": "2ff22b6b76a098c5db5019967a964fda50570c0970542cfe3662fc5753357c31", "detail": {"candidateDigest": "65c990c7494fa2ecf73a34b0d8b242ad52394babf6d439da912f29a541aa4ad7", "testEvidenceDigest": "0ba07949371377af233c39008f7ee4a08187ded052048d6e90a45a33a361822e", "baselinePassed": true, "contextBoundTactics": ["861edbda8123cd56f00dcedf1e98cd06325e11d242df61b3f86551a2a6df0b36", "702952fe0ea2cf79ebc6fbcd1bc4dd976c936a026ec6c58106ef32c9878ed359"], "omittedTactics": 0, "contextBoundTransitions": ["1a7f9015b036b5bcbdac46c0c9429f55207157322f012dac949069f5e7027fe0", "5118f60a2679b58f7d4ffccf57caaa3529965b86de83f5c63ea0e31b04bf735c"], "omittedTransitions": 0}}
{"kind": "decision", "digest": "9205991c54a1be7624a41aa5dc61e263127fa2038111eb636f6e1a266c8e0465", "detail": {"action": "rollback", "reason": "new_public_failure", "championDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}}
{"kind": "action", "digest": "64c5ab1a7707cc9a854431bedd61061f7855a18d0866e8c94b7209a94f3f4730", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"a\": 0", "newText": "\"a\": 3"}}
{"kind": "decision", "digest": "0672715a942eb5d4e414aaabc99ce4bcf488ca684dc09eb0b67c02df2ea6d6c2", "detail": {"action": "suppress_duplicate", "tactic": "861edbda8123cd56f00dcedf1e98cd06325e11d242df61b3f86551a2a6df0b36"}}
{"kind": "action", "digest": "64c5ab1a7707cc9a854431bedd61061f7855a18d0866e8c94b7209a94f3f4730", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"a\": 0", "newText": "\"a\": 3"}}
{"kind": "decision", "digest": "0672715a942eb5d4e414aaabc99ce4bcf488ca684dc09eb0b67c02df2ea6d6c2", "detail": {"action": "suppress_duplicate", "tactic": "861edbda8123cd56f00dcedf1e98cd06325e11d242df61b3f86551a2a6df0b36"}}
{"kind": "action", "digest": "64c5ab1a7707cc9a854431bedd61061f7855a18d0866e8c94b7209a94f3f4730", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"a\": 0", "newText": "\"a\": 3"}}
{"kind": "decision", "digest": "0672715a942eb5d4e414aaabc99ce4bcf488ca684dc09eb0b67c02df2ea6d6c2", "detail": {"action": "suppress_duplicate", "tactic": "861edbda8123cd56f00dcedf1e98cd06325e11d242df61b3f86551a2a6df0b36"}}
{"kind": "action", "digest": "64c5ab1a7707cc9a854431bedd61061f7855a18d0866e8c94b7209a94f3f4730", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"a\": 0", "newText": "\"a\": 3"}}
{"kind": "decision", "digest": "0672715a942eb5d4e414aaabc99ce4bcf488ca684dc09eb0b67c02df2ea6d6c2", "detail": {"action": "suppress_duplicate", "tactic": "861edbda8123cd56f00dcedf1e98cd06325e11d242df61b3f86551a2a6df0b36"}}
{"kind": "action", "digest": "af062acbe3e64aa039672b0bc0197abeb443bf0cc9685e7d96ea67d18afdb7d7", "detail": {"action": "test"}}
{"kind": "public_test", "digest": "5bb579d78c1cda817da5f79ec788e91fffced9440cc98dede96d592f39361c95", "detail": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":0,\"expected\":0,\"passed\":true}]\n", "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}}
{"kind": "decision", "digest": "a76adc2ccbf002903ca4f4ef4511c25c2aa90deb5ab7f228356d268723797730", "detail": {"action": "champion", "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}}
{"kind": "action", "digest": "e6eb33a0cb65b8eca0a8d3e1f2e36b594fa9eed3d8d877c3c560b437e9b28e38", "detail": {"action": "finish"}}
{"kind": "decision", "digest": "8ecb3411cf3577517eb5426c0921bea38b9226409e95e24ba78b32b98d57f54a", "detail": {"action": "reject_finish", "reason": "rollback_restored_unrepaired_baseline", "failureEvidenceDigest": "2ff22b6b76a098c5db5019967a964fda50570c0970542cfe3662fc5753357c31", "restoredPatchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "instruction": "The failed repair was rolled back. Public green on the original checkout does not resolve the issue. Try a materially different hypothesis using the remaining original budget, or finish if no justified alternative remains."}}
{"kind": "action", "digest": "e6eb33a0cb65b8eca0a8d3e1f2e36b594fa9eed3d8d877c3c560b437e9b28e38", "detail": {"action": "finish"}}
{"resolved": false, "gradeStatus": "completed", "freshPublic": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":0,\"expected\":0,\"passed\":true}]\n"}, "privateGrade": {"exitCode": 1, "output": "[{\"input\":4,\"actual\":0,\"expected\":12,\"passed\":false},{\"input\":-2,\"actual\":0,\"expected\":-6,\"passed\":false}]\n"}, "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "partialProgress": {"alignedStates": 3, "lossTransitions": 1, "reusedAfterLoss": 0, "finalAligned": false, "meaning": "requirement-aligned fields, assessed after freeze; not independently verified intermediate repair"}}
{"status": "finished", "reason": "model_finish", "modelRequests": 18, "accountingComplete": true, "unreconciledModelRequests": 0}
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
{"resolved": true, "gradeStatus": "completed", "freshPublic": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":0,\"expected\":0,\"passed\":true}]\n"}, "privateGrade": {"exitCode": 0, "output": "[{\"input\":4,\"actual\":12,\"expected\":12,\"passed\":true},{\"input\":-2,\"actual\":-6,\"expected\":-6,\"passed\":true}]\n"}, "patchDigest": "21f992c14c1a879271582192643235ae9d553f34ce2f08bd1de6c30bc6dbe9ec", "partialProgress": {"alignedStates": 5, "lossTransitions": 1, "reusedAfterLoss": 1, "finalAligned": true, "meaning": "requirement-aligned fields, assessed after freeze; not independently verified intermediate repair"}}
{"status": "finished", "reason": "model_finish", "modelRequests": 17, "accountingComplete": true, "unreconciledModelRequests": 0}
```

## range-batch / responsive / C

```json
{"kind": "public_test", "digest": "30089f5ace98f6fb02216b1b4ef66df1ea7fede42fff4459e6d51a5c37ebbf7d", "detail": {"exitCode": 0, "output": "[{\"input\":20,\"actual\":10,\"expected\":10,\"passed\":true}]\n", "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}}
{"kind": "action", "digest": "c77fc2d7b4ee58c4c3a2ef9e683056513bc2c965619f778ad24bf0a0ff4586e9", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"lo\": 0", "newText": "\"lo\": 2"}}
{"kind": "action", "digest": "8eae69b72e9e02381d8d6bb12b3dda7efba24c06955e6445bd687490ed161055", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"hi\": 10", "newText": "\"hi\": 8"}}
{"kind": "action", "digest": "af062acbe3e64aa039672b0bc0197abeb443bf0cc9685e7d96ea67d18afdb7d7", "detail": {"action": "test"}}
{"kind": "public_test", "digest": "ef0cb7e06153addd0b88a11d9c053985dd545f7de4005ef91c5a8da5af52eee6", "detail": {"exitCode": 1, "output": "[{\"input\":20,\"actual\":8,\"expected\":10,\"passed\":false}]\n", "patchDigest": "74d4effb782715ab58e868a0a84903be8eca020595e3d75d13e15eb88fd7c2b2"}}
{"kind": "failure_memory", "digest": "c61c76eb93f58a64f124fc8de72602e54430c326f0eca248149e1df685bf185b", "detail": {"candidateDigest": "74d4effb782715ab58e868a0a84903be8eca020595e3d75d13e15eb88fd7c2b2", "testEvidenceDigest": "ef0cb7e06153addd0b88a11d9c053985dd545f7de4005ef91c5a8da5af52eee6", "baselinePassed": true, "attribution": "tested_terminal_transition", "contextBoundTactics": ["2d556504a045a1d995cfbf4e5be9dd7cb1e644fa4958f4d2ff5335b872360b3e"], "omittedTactics": 0, "contextBoundTransitions": ["18166434feb1a98afbe08a39e11d76de15addc82e6fbca2549ec2ecbab9d3ed5"], "omittedTransitions": 0, "untestedIntermediateTactics": ["60ce7c17d0d850408b55f3a9664fef81117001fab9ba7ef1737a36a1701bf425"], "omittedIntermediateTactics": 0}}
{"kind": "decision", "digest": "9205991c54a1be7624a41aa5dc61e263127fa2038111eb636f6e1a266c8e0465", "detail": {"action": "rollback", "reason": "new_public_failure", "championDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}}
{"kind": "action", "digest": "c77fc2d7b4ee58c4c3a2ef9e683056513bc2c965619f778ad24bf0a0ff4586e9", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"lo\": 0", "newText": "\"lo\": 2"}}
{"kind": "action", "digest": "af062acbe3e64aa039672b0bc0197abeb443bf0cc9685e7d96ea67d18afdb7d7", "detail": {"action": "test"}}
{"kind": "public_test", "digest": "28ad50b97e396af9f18e56a4f09baa713b6684cf76d23d80bff00423bd7d09d6", "detail": {"exitCode": 0, "output": "[{\"input\":20,\"actual\":10,\"expected\":10,\"passed\":true}]\n", "patchDigest": "311c91fdb717088c75a23b269ebbd43bb12a6b0780cc78a6b304cdc1ad50d6a4"}}
{"kind": "decision", "digest": "811529ccd35195cc787d21295a3e894c47513e4f966a8eb0a86040c4fd924299", "detail": {"action": "champion", "patchDigest": "311c91fdb717088c75a23b269ebbd43bb12a6b0780cc78a6b304cdc1ad50d6a4"}}
{"kind": "action", "digest": "e6eb33a0cb65b8eca0a8d3e1f2e36b594fa9eed3d8d877c3c560b437e9b28e38", "detail": {"action": "finish"}}
{"resolved": true, "gradeStatus": "completed", "freshPublic": {"exitCode": 0, "output": "[{\"input\":20,\"actual\":10,\"expected\":10,\"passed\":true}]\n"}, "privateGrade": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":2,\"expected\":2,\"passed\":true},{\"input\":5,\"actual\":5,\"expected\":5,\"passed\":true}]\n"}, "patchDigest": "311c91fdb717088c75a23b269ebbd43bb12a6b0780cc78a6b304cdc1ad50d6a4", "partialProgress": {"alignedStates": 5, "lossTransitions": 1, "reusedAfterLoss": 1, "finalAligned": true, "meaning": "requirement-aligned fields, assessed after freeze; not independently verified intermediate repair"}}
{"status": "finished", "reason": "model_finish", "modelRequests": 11, "accountingComplete": true, "unreconciledModelRequests": 0}
```

## price-batch / unresponsive / C

```json
{"kind": "public_test", "digest": "5bb579d78c1cda817da5f79ec788e91fffced9440cc98dede96d592f39361c95", "detail": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":0,\"expected\":0,\"passed\":true}]\n", "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}}
{"kind": "action", "digest": "bc6d1ea9d09f3ce7562885760d83ed81e5f1d53f2a31d41d1a70a410831d06d9", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"rate\": 0", "newText": "\"rate\": 0.25"}}
{"kind": "action", "digest": "eaf2765c64d75eb080bb951054c1404478ea2ccf6fcf9719598f0b0910125742", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"fee\": 0", "newText": "\"fee\": 2"}}
{"kind": "action", "digest": "af062acbe3e64aa039672b0bc0197abeb443bf0cc9685e7d96ea67d18afdb7d7", "detail": {"action": "test"}}
{"kind": "public_test", "digest": "e8f1137782ca8dc178b0e239c420d66c0f8ae4f4e5498899506dd7e70d279bc5", "detail": {"exitCode": 1, "output": "[{\"input\":0,\"actual\":2,\"expected\":0,\"passed\":false}]\n", "patchDigest": "783cc271220ce3a74247b040caf02f11d2704445c6595368bc8ab62ef692bea0"}}
{"kind": "failure_memory", "digest": "d0934a5f9263ab7afa8f1d9561043c559e334cb92e0b68b5f044d19351fe3731", "detail": {"candidateDigest": "783cc271220ce3a74247b040caf02f11d2704445c6595368bc8ab62ef692bea0", "testEvidenceDigest": "e8f1137782ca8dc178b0e239c420d66c0f8ae4f4e5498899506dd7e70d279bc5", "baselinePassed": true, "attribution": "tested_terminal_transition", "contextBoundTactics": ["7aeccbfa058151782a9d0ffd28e934b9855fc9c2e1695e9db5a9dd7bf3505697"], "omittedTactics": 0, "contextBoundTransitions": ["ff2f26062781d8620afa2e95d225d334605f00a7bea5434a3eacda2453e42e65"], "omittedTransitions": 0, "untestedIntermediateTactics": ["d63610c3d7623fef2efc821ff4b66ea633cfac99161c4da809d84418fdfbb0bb"], "omittedIntermediateTactics": 0}}
{"kind": "decision", "digest": "9205991c54a1be7624a41aa5dc61e263127fa2038111eb636f6e1a266c8e0465", "detail": {"action": "rollback", "reason": "new_public_failure", "championDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}}
{"kind": "action", "digest": "bc6d1ea9d09f3ce7562885760d83ed81e5f1d53f2a31d41d1a70a410831d06d9", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"rate\": 0", "newText": "\"rate\": 0.25"}}
{"kind": "action", "digest": "eaf2765c64d75eb080bb951054c1404478ea2ccf6fcf9719598f0b0910125742", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"fee\": 0", "newText": "\"fee\": 2"}}
{"kind": "decision", "digest": "b952ddf8dcb1f3f8068182073d2f2cdb21330911ec7b81c9e3a81c8df5cdf70d", "detail": {"action": "suppress_duplicate", "tactic": "7aeccbfa058151782a9d0ffd28e934b9855fc9c2e1695e9db5a9dd7bf3505697"}}
{"kind": "action", "digest": "eaf2765c64d75eb080bb951054c1404478ea2ccf6fcf9719598f0b0910125742", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"fee\": 0", "newText": "\"fee\": 2"}}
{"kind": "decision", "digest": "b952ddf8dcb1f3f8068182073d2f2cdb21330911ec7b81c9e3a81c8df5cdf70d", "detail": {"action": "suppress_duplicate", "tactic": "7aeccbfa058151782a9d0ffd28e934b9855fc9c2e1695e9db5a9dd7bf3505697"}}
{"kind": "action", "digest": "eaf2765c64d75eb080bb951054c1404478ea2ccf6fcf9719598f0b0910125742", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"fee\": 0", "newText": "\"fee\": 2"}}
{"kind": "decision", "digest": "b952ddf8dcb1f3f8068182073d2f2cdb21330911ec7b81c9e3a81c8df5cdf70d", "detail": {"action": "suppress_duplicate", "tactic": "7aeccbfa058151782a9d0ffd28e934b9855fc9c2e1695e9db5a9dd7bf3505697"}}
{"kind": "action", "digest": "eaf2765c64d75eb080bb951054c1404478ea2ccf6fcf9719598f0b0910125742", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"fee\": 0", "newText": "\"fee\": 2"}}
{"kind": "decision", "digest": "b952ddf8dcb1f3f8068182073d2f2cdb21330911ec7b81c9e3a81c8df5cdf70d", "detail": {"action": "suppress_duplicate", "tactic": "7aeccbfa058151782a9d0ffd28e934b9855fc9c2e1695e9db5a9dd7bf3505697"}}
{"kind": "action", "digest": "eaf2765c64d75eb080bb951054c1404478ea2ccf6fcf9719598f0b0910125742", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"fee\": 0", "newText": "\"fee\": 2"}}
{"kind": "decision", "digest": "b952ddf8dcb1f3f8068182073d2f2cdb21330911ec7b81c9e3a81c8df5cdf70d", "detail": {"action": "suppress_duplicate", "tactic": "7aeccbfa058151782a9d0ffd28e934b9855fc9c2e1695e9db5a9dd7bf3505697"}}
{"kind": "action", "digest": "eaf2765c64d75eb080bb951054c1404478ea2ccf6fcf9719598f0b0910125742", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"fee\": 0", "newText": "\"fee\": 2"}}
{"kind": "decision", "digest": "b952ddf8dcb1f3f8068182073d2f2cdb21330911ec7b81c9e3a81c8df5cdf70d", "detail": {"action": "suppress_duplicate", "tactic": "7aeccbfa058151782a9d0ffd28e934b9855fc9c2e1695e9db5a9dd7bf3505697"}}
{"kind": "action", "digest": "eaf2765c64d75eb080bb951054c1404478ea2ccf6fcf9719598f0b0910125742", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"fee\": 0", "newText": "\"fee\": 2"}}
{"kind": "decision", "digest": "b952ddf8dcb1f3f8068182073d2f2cdb21330911ec7b81c9e3a81c8df5cdf70d", "detail": {"action": "suppress_duplicate", "tactic": "7aeccbfa058151782a9d0ffd28e934b9855fc9c2e1695e9db5a9dd7bf3505697"}}
{"kind": "action", "digest": "eaf2765c64d75eb080bb951054c1404478ea2ccf6fcf9719598f0b0910125742", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"fee\": 0", "newText": "\"fee\": 2"}}
{"kind": "decision", "digest": "b952ddf8dcb1f3f8068182073d2f2cdb21330911ec7b81c9e3a81c8df5cdf70d", "detail": {"action": "suppress_duplicate", "tactic": "7aeccbfa058151782a9d0ffd28e934b9855fc9c2e1695e9db5a9dd7bf3505697"}}
{"kind": "action", "digest": "eaf2765c64d75eb080bb951054c1404478ea2ccf6fcf9719598f0b0910125742", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"fee\": 0", "newText": "\"fee\": 2"}}
{"kind": "decision", "digest": "b952ddf8dcb1f3f8068182073d2f2cdb21330911ec7b81c9e3a81c8df5cdf70d", "detail": {"action": "suppress_duplicate", "tactic": "7aeccbfa058151782a9d0ffd28e934b9855fc9c2e1695e9db5a9dd7bf3505697"}}
{"kind": "action", "digest": "eaf2765c64d75eb080bb951054c1404478ea2ccf6fcf9719598f0b0910125742", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"fee\": 0", "newText": "\"fee\": 2"}}
{"kind": "decision", "digest": "b952ddf8dcb1f3f8068182073d2f2cdb21330911ec7b81c9e3a81c8df5cdf70d", "detail": {"action": "suppress_duplicate", "tactic": "7aeccbfa058151782a9d0ffd28e934b9855fc9c2e1695e9db5a9dd7bf3505697"}}
{"kind": "action", "digest": "eaf2765c64d75eb080bb951054c1404478ea2ccf6fcf9719598f0b0910125742", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"fee\": 0", "newText": "\"fee\": 2"}}
{"kind": "decision", "digest": "b952ddf8dcb1f3f8068182073d2f2cdb21330911ec7b81c9e3a81c8df5cdf70d", "detail": {"action": "suppress_duplicate", "tactic": "7aeccbfa058151782a9d0ffd28e934b9855fc9c2e1695e9db5a9dd7bf3505697"}}
{"kind": "action", "digest": "eaf2765c64d75eb080bb951054c1404478ea2ccf6fcf9719598f0b0910125742", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"fee\": 0", "newText": "\"fee\": 2"}}
{"kind": "decision", "digest": "b952ddf8dcb1f3f8068182073d2f2cdb21330911ec7b81c9e3a81c8df5cdf70d", "detail": {"action": "suppress_duplicate", "tactic": "7aeccbfa058151782a9d0ffd28e934b9855fc9c2e1695e9db5a9dd7bf3505697"}}
{"kind": "action", "digest": "eaf2765c64d75eb080bb951054c1404478ea2ccf6fcf9719598f0b0910125742", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"fee\": 0", "newText": "\"fee\": 2"}}
{"kind": "decision", "digest": "b952ddf8dcb1f3f8068182073d2f2cdb21330911ec7b81c9e3a81c8df5cdf70d", "detail": {"action": "suppress_duplicate", "tactic": "7aeccbfa058151782a9d0ffd28e934b9855fc9c2e1695e9db5a9dd7bf3505697"}}
{"kind": "action", "digest": "eaf2765c64d75eb080bb951054c1404478ea2ccf6fcf9719598f0b0910125742", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"fee\": 0", "newText": "\"fee\": 2"}}
{"kind": "decision", "digest": "b952ddf8dcb1f3f8068182073d2f2cdb21330911ec7b81c9e3a81c8df5cdf70d", "detail": {"action": "suppress_duplicate", "tactic": "7aeccbfa058151782a9d0ffd28e934b9855fc9c2e1695e9db5a9dd7bf3505697"}}
{"kind": "action", "digest": "eaf2765c64d75eb080bb951054c1404478ea2ccf6fcf9719598f0b0910125742", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"fee\": 0", "newText": "\"fee\": 2"}}
{"kind": "decision", "digest": "b952ddf8dcb1f3f8068182073d2f2cdb21330911ec7b81c9e3a81c8df5cdf70d", "detail": {"action": "suppress_duplicate", "tactic": "7aeccbfa058151782a9d0ffd28e934b9855fc9c2e1695e9db5a9dd7bf3505697"}}
{"kind": "action", "digest": "eaf2765c64d75eb080bb951054c1404478ea2ccf6fcf9719598f0b0910125742", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"fee\": 0", "newText": "\"fee\": 2"}}
{"kind": "decision", "digest": "b952ddf8dcb1f3f8068182073d2f2cdb21330911ec7b81c9e3a81c8df5cdf70d", "detail": {"action": "suppress_duplicate", "tactic": "7aeccbfa058151782a9d0ffd28e934b9855fc9c2e1695e9db5a9dd7bf3505697"}}
{"kind": "action", "digest": "eaf2765c64d75eb080bb951054c1404478ea2ccf6fcf9719598f0b0910125742", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"fee\": 0", "newText": "\"fee\": 2"}}
{"kind": "decision", "digest": "b952ddf8dcb1f3f8068182073d2f2cdb21330911ec7b81c9e3a81c8df5cdf70d", "detail": {"action": "suppress_duplicate", "tactic": "7aeccbfa058151782a9d0ffd28e934b9855fc9c2e1695e9db5a9dd7bf3505697"}}
{"kind": "action", "digest": "eaf2765c64d75eb080bb951054c1404478ea2ccf6fcf9719598f0b0910125742", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"fee\": 0", "newText": "\"fee\": 2"}}
{"kind": "decision", "digest": "b952ddf8dcb1f3f8068182073d2f2cdb21330911ec7b81c9e3a81c8df5cdf70d", "detail": {"action": "suppress_duplicate", "tactic": "7aeccbfa058151782a9d0ffd28e934b9855fc9c2e1695e9db5a9dd7bf3505697"}}
{"kind": "action", "digest": "eaf2765c64d75eb080bb951054c1404478ea2ccf6fcf9719598f0b0910125742", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"fee\": 0", "newText": "\"fee\": 2"}}
{"kind": "decision", "digest": "b952ddf8dcb1f3f8068182073d2f2cdb21330911ec7b81c9e3a81c8df5cdf70d", "detail": {"action": "suppress_duplicate", "tactic": "7aeccbfa058151782a9d0ffd28e934b9855fc9c2e1695e9db5a9dd7bf3505697"}}
{"kind": "action", "digest": "eaf2765c64d75eb080bb951054c1404478ea2ccf6fcf9719598f0b0910125742", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"fee\": 0", "newText": "\"fee\": 2"}}
{"kind": "decision", "digest": "b952ddf8dcb1f3f8068182073d2f2cdb21330911ec7b81c9e3a81c8df5cdf70d", "detail": {"action": "suppress_duplicate", "tactic": "7aeccbfa058151782a9d0ffd28e934b9855fc9c2e1695e9db5a9dd7bf3505697"}}
{"kind": "action", "digest": "eaf2765c64d75eb080bb951054c1404478ea2ccf6fcf9719598f0b0910125742", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"fee\": 0", "newText": "\"fee\": 2"}}
{"kind": "decision", "digest": "b952ddf8dcb1f3f8068182073d2f2cdb21330911ec7b81c9e3a81c8df5cdf70d", "detail": {"action": "suppress_duplicate", "tactic": "7aeccbfa058151782a9d0ffd28e934b9855fc9c2e1695e9db5a9dd7bf3505697"}}
{"resolved": true, "gradeStatus": "completed", "freshPublic": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":0,\"expected\":0,\"passed\":true}]\n"}, "privateGrade": {"exitCode": 0, "output": "[{\"input\":20,\"actual\":15,\"expected\":15,\"passed\":true},{\"input\":100,\"actual\":75,\"expected\":75,\"passed\":true}]\n"}, "patchDigest": "65efaa82caff73f3ae042c5c52d78ab064799eef5ed4b2008c2eb1d02aa2e12e", "partialProgress": {"alignedStates": 4, "lossTransitions": 1, "reusedAfterLoss": 1, "finalAligned": true, "meaning": "requirement-aligned fields, assessed after freeze; not independently verified intermediate repair"}}
{"status": "exhausted", "reason": "limits", "modelRequests": 50, "accountingComplete": true, "unreconciledModelRequests": 0}
```

## prefix-can-regress / unresponsive / B

```json
{"kind": "public_test", "digest": "3e47c2fa7104977ac3d0ee7d3016f225b9cfac626fe6546fbf0f293b5ddfdf74", "detail": {"exitCode": 0, "output": "[{\"input\":1,\"actual\":0,\"expected\":0,\"passed\":true}]\n", "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}}
{"kind": "action", "digest": "fb8193ad0968195e4f4d9ab9271567685c84c66f05c0122364da6ff3afe14f2a", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"a\": 0", "newText": "\"a\": 2"}}
{"kind": "action", "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"b\": 0", "newText": "\"b\": 1"}}
{"kind": "action", "digest": "af062acbe3e64aa039672b0bc0197abeb443bf0cc9685e7d96ea67d18afdb7d7", "detail": {"action": "test"}}
{"kind": "public_test", "digest": "eefb75a9f4e17f7f5a50318d69e0851ba6d55a3f55d5c8dd9c33f7fc5d4864db", "detail": {"exitCode": 1, "output": "[{\"input\":1,\"actual\":3,\"expected\":0,\"passed\":false}]\n", "patchDigest": "ae6d529148ff5fdd744e0ecd39d6db9b168efa5705e5e2544c13b9c80c5718e9"}}
{"kind": "failure_memory", "digest": "8c42cf8f62382a0a9c7ed1abde970e86135a41097c1e351302ad787801a97984", "detail": {"candidateDigest": "ae6d529148ff5fdd744e0ecd39d6db9b168efa5705e5e2544c13b9c80c5718e9", "testEvidenceDigest": "eefb75a9f4e17f7f5a50318d69e0851ba6d55a3f55d5c8dd9c33f7fc5d4864db", "baselinePassed": true, "contextBoundTactics": ["a375d7447174ed3e216dafe3ccfeff6a0d98229ae5e3b3a273c9116e738e3ebb", "bac6d6c3db9cb5c17d54d6deafbf3feae79084760e8ebfa498e989e410494b30"], "omittedTactics": 0, "contextBoundTransitions": ["e2e1e1d5a0299f47ce2156ef6c9a1d34fd0ee338fca6b1089cbc74fc8c6c0902", "4096cf87023deb978f4f5464691db99868622d0430ce4b5395228daa7ebd3bf2"], "omittedTransitions": 0}}
{"kind": "decision", "digest": "9205991c54a1be7624a41aa5dc61e263127fa2038111eb636f6e1a266c8e0465", "detail": {"action": "rollback", "reason": "new_public_failure", "championDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}}
{"kind": "action", "digest": "fb8193ad0968195e4f4d9ab9271567685c84c66f05c0122364da6ff3afe14f2a", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"a\": 0", "newText": "\"a\": 2"}}
{"kind": "decision", "digest": "ca0df3728226b87f7aaf9b0268e99614007e31794aaa601d676900a0cff4af5b", "detail": {"action": "suppress_duplicate", "tactic": "a375d7447174ed3e216dafe3ccfeff6a0d98229ae5e3b3a273c9116e738e3ebb"}}
{"kind": "action", "digest": "fb8193ad0968195e4f4d9ab9271567685c84c66f05c0122364da6ff3afe14f2a", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"a\": 0", "newText": "\"a\": 2"}}
{"kind": "decision", "digest": "ca0df3728226b87f7aaf9b0268e99614007e31794aaa601d676900a0cff4af5b", "detail": {"action": "suppress_duplicate", "tactic": "a375d7447174ed3e216dafe3ccfeff6a0d98229ae5e3b3a273c9116e738e3ebb"}}
{"kind": "action", "digest": "fb8193ad0968195e4f4d9ab9271567685c84c66f05c0122364da6ff3afe14f2a", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"a\": 0", "newText": "\"a\": 2"}}
{"kind": "decision", "digest": "ca0df3728226b87f7aaf9b0268e99614007e31794aaa601d676900a0cff4af5b", "detail": {"action": "suppress_duplicate", "tactic": "a375d7447174ed3e216dafe3ccfeff6a0d98229ae5e3b3a273c9116e738e3ebb"}}
{"kind": "action", "digest": "fb8193ad0968195e4f4d9ab9271567685c84c66f05c0122364da6ff3afe14f2a", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"a\": 0", "newText": "\"a\": 2"}}
{"kind": "decision", "digest": "ca0df3728226b87f7aaf9b0268e99614007e31794aaa601d676900a0cff4af5b", "detail": {"action": "suppress_duplicate", "tactic": "a375d7447174ed3e216dafe3ccfeff6a0d98229ae5e3b3a273c9116e738e3ebb"}}
{"kind": "action", "digest": "fb8193ad0968195e4f4d9ab9271567685c84c66f05c0122364da6ff3afe14f2a", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"a\": 0", "newText": "\"a\": 2"}}
{"kind": "decision", "digest": "ca0df3728226b87f7aaf9b0268e99614007e31794aaa601d676900a0cff4af5b", "detail": {"action": "suppress_duplicate", "tactic": "a375d7447174ed3e216dafe3ccfeff6a0d98229ae5e3b3a273c9116e738e3ebb"}}
{"kind": "action", "digest": "fb8193ad0968195e4f4d9ab9271567685c84c66f05c0122364da6ff3afe14f2a", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"a\": 0", "newText": "\"a\": 2"}}
{"kind": "decision", "digest": "ca0df3728226b87f7aaf9b0268e99614007e31794aaa601d676900a0cff4af5b", "detail": {"action": "suppress_duplicate", "tactic": "a375d7447174ed3e216dafe3ccfeff6a0d98229ae5e3b3a273c9116e738e3ebb"}}
{"kind": "action", "digest": "fb8193ad0968195e4f4d9ab9271567685c84c66f05c0122364da6ff3afe14f2a", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"a\": 0", "newText": "\"a\": 2"}}
{"kind": "decision", "digest": "ca0df3728226b87f7aaf9b0268e99614007e31794aaa601d676900a0cff4af5b", "detail": {"action": "suppress_duplicate", "tactic": "a375d7447174ed3e216dafe3ccfeff6a0d98229ae5e3b3a273c9116e738e3ebb"}}
{"kind": "action", "digest": "fb8193ad0968195e4f4d9ab9271567685c84c66f05c0122364da6ff3afe14f2a", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"a\": 0", "newText": "\"a\": 2"}}
{"kind": "decision", "digest": "ca0df3728226b87f7aaf9b0268e99614007e31794aaa601d676900a0cff4af5b", "detail": {"action": "suppress_duplicate", "tactic": "a375d7447174ed3e216dafe3ccfeff6a0d98229ae5e3b3a273c9116e738e3ebb"}}
{"kind": "action", "digest": "fb8193ad0968195e4f4d9ab9271567685c84c66f05c0122364da6ff3afe14f2a", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"a\": 0", "newText": "\"a\": 2"}}
{"kind": "decision", "digest": "ca0df3728226b87f7aaf9b0268e99614007e31794aaa601d676900a0cff4af5b", "detail": {"action": "suppress_duplicate", "tactic": "a375d7447174ed3e216dafe3ccfeff6a0d98229ae5e3b3a273c9116e738e3ebb"}}
{"kind": "action", "digest": "fb8193ad0968195e4f4d9ab9271567685c84c66f05c0122364da6ff3afe14f2a", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"a\": 0", "newText": "\"a\": 2"}}
{"kind": "decision", "digest": "ca0df3728226b87f7aaf9b0268e99614007e31794aaa601d676900a0cff4af5b", "detail": {"action": "suppress_duplicate", "tactic": "a375d7447174ed3e216dafe3ccfeff6a0d98229ae5e3b3a273c9116e738e3ebb"}}
{"kind": "action", "digest": "fb8193ad0968195e4f4d9ab9271567685c84c66f05c0122364da6ff3afe14f2a", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"a\": 0", "newText": "\"a\": 2"}}
{"kind": "decision", "digest": "ca0df3728226b87f7aaf9b0268e99614007e31794aaa601d676900a0cff4af5b", "detail": {"action": "suppress_duplicate", "tactic": "a375d7447174ed3e216dafe3ccfeff6a0d98229ae5e3b3a273c9116e738e3ebb"}}
{"kind": "action", "digest": "fb8193ad0968195e4f4d9ab9271567685c84c66f05c0122364da6ff3afe14f2a", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"a\": 0", "newText": "\"a\": 2"}}
{"kind": "decision", "digest": "ca0df3728226b87f7aaf9b0268e99614007e31794aaa601d676900a0cff4af5b", "detail": {"action": "suppress_duplicate", "tactic": "a375d7447174ed3e216dafe3ccfeff6a0d98229ae5e3b3a273c9116e738e3ebb"}}
{"kind": "action", "digest": "fb8193ad0968195e4f4d9ab9271567685c84c66f05c0122364da6ff3afe14f2a", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"a\": 0", "newText": "\"a\": 2"}}
{"kind": "decision", "digest": "ca0df3728226b87f7aaf9b0268e99614007e31794aaa601d676900a0cff4af5b", "detail": {"action": "suppress_duplicate", "tactic": "a375d7447174ed3e216dafe3ccfeff6a0d98229ae5e3b3a273c9116e738e3ebb"}}
{"kind": "action", "digest": "fb8193ad0968195e4f4d9ab9271567685c84c66f05c0122364da6ff3afe14f2a", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"a\": 0", "newText": "\"a\": 2"}}
{"kind": "decision", "digest": "ca0df3728226b87f7aaf9b0268e99614007e31794aaa601d676900a0cff4af5b", "detail": {"action": "suppress_duplicate", "tactic": "a375d7447174ed3e216dafe3ccfeff6a0d98229ae5e3b3a273c9116e738e3ebb"}}
{"kind": "action", "digest": "fb8193ad0968195e4f4d9ab9271567685c84c66f05c0122364da6ff3afe14f2a", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"a\": 0", "newText": "\"a\": 2"}}
{"kind": "decision", "digest": "ca0df3728226b87f7aaf9b0268e99614007e31794aaa601d676900a0cff4af5b", "detail": {"action": "suppress_duplicate", "tactic": "a375d7447174ed3e216dafe3ccfeff6a0d98229ae5e3b3a273c9116e738e3ebb"}}
{"kind": "action", "digest": "fb8193ad0968195e4f4d9ab9271567685c84c66f05c0122364da6ff3afe14f2a", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"a\": 0", "newText": "\"a\": 2"}}
{"kind": "decision", "digest": "ca0df3728226b87f7aaf9b0268e99614007e31794aaa601d676900a0cff4af5b", "detail": {"action": "suppress_duplicate", "tactic": "a375d7447174ed3e216dafe3ccfeff6a0d98229ae5e3b3a273c9116e738e3ebb"}}
{"kind": "action", "digest": "fb8193ad0968195e4f4d9ab9271567685c84c66f05c0122364da6ff3afe14f2a", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"a\": 0", "newText": "\"a\": 2"}}
{"kind": "decision", "digest": "ca0df3728226b87f7aaf9b0268e99614007e31794aaa601d676900a0cff4af5b", "detail": {"action": "suppress_duplicate", "tactic": "a375d7447174ed3e216dafe3ccfeff6a0d98229ae5e3b3a273c9116e738e3ebb"}}
{"kind": "action", "digest": "fb8193ad0968195e4f4d9ab9271567685c84c66f05c0122364da6ff3afe14f2a", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"a\": 0", "newText": "\"a\": 2"}}
{"kind": "decision", "digest": "ca0df3728226b87f7aaf9b0268e99614007e31794aaa601d676900a0cff4af5b", "detail": {"action": "suppress_duplicate", "tactic": "a375d7447174ed3e216dafe3ccfeff6a0d98229ae5e3b3a273c9116e738e3ebb"}}
{"kind": "action", "digest": "fb8193ad0968195e4f4d9ab9271567685c84c66f05c0122364da6ff3afe14f2a", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"a\": 0", "newText": "\"a\": 2"}}
{"kind": "decision", "digest": "ca0df3728226b87f7aaf9b0268e99614007e31794aaa601d676900a0cff4af5b", "detail": {"action": "suppress_duplicate", "tactic": "a375d7447174ed3e216dafe3ccfeff6a0d98229ae5e3b3a273c9116e738e3ebb"}}
{"kind": "action", "digest": "fb8193ad0968195e4f4d9ab9271567685c84c66f05c0122364da6ff3afe14f2a", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"a\": 0", "newText": "\"a\": 2"}}
{"kind": "decision", "digest": "ca0df3728226b87f7aaf9b0268e99614007e31794aaa601d676900a0cff4af5b", "detail": {"action": "suppress_duplicate", "tactic": "a375d7447174ed3e216dafe3ccfeff6a0d98229ae5e3b3a273c9116e738e3ebb"}}
{"kind": "action", "digest": "fb8193ad0968195e4f4d9ab9271567685c84c66f05c0122364da6ff3afe14f2a", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"a\": 0", "newText": "\"a\": 2"}}
{"kind": "decision", "digest": "ca0df3728226b87f7aaf9b0268e99614007e31794aaa601d676900a0cff4af5b", "detail": {"action": "suppress_duplicate", "tactic": "a375d7447174ed3e216dafe3ccfeff6a0d98229ae5e3b3a273c9116e738e3ebb"}}
{"kind": "action", "digest": "fb8193ad0968195e4f4d9ab9271567685c84c66f05c0122364da6ff3afe14f2a", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"a\": 0", "newText": "\"a\": 2"}}
{"kind": "decision", "digest": "ca0df3728226b87f7aaf9b0268e99614007e31794aaa601d676900a0cff4af5b", "detail": {"action": "suppress_duplicate", "tactic": "a375d7447174ed3e216dafe3ccfeff6a0d98229ae5e3b3a273c9116e738e3ebb"}}
{"resolved": false, "gradeStatus": "completed", "freshPublic": {"exitCode": 0, "output": "[{\"input\":1,\"actual\":0,\"expected\":0,\"passed\":true}]\n"}, "privateGrade": {"exitCode": 1, "output": "[{\"input\":0,\"actual\":0,\"expected\":-2,\"passed\":false},{\"input\":3,\"actual\":0,\"expected\":4,\"passed\":false}]\n"}, "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "partialProgress": {"alignedStates": 3, "lossTransitions": 1, "reusedAfterLoss": 0, "finalAligned": false, "meaning": "requirement-aligned fields, assessed after freeze; not independently verified intermediate repair"}}
{"status": "exhausted", "reason": "limits", "modelRequests": 50, "accountingComplete": true, "unreconciledModelRequests": 0}
```

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
{"resolved": false, "gradeStatus": "completed", "freshPublic": {"exitCode": 1, "output": "[{\"input\":1,\"actual\":2,\"expected\":0,\"passed\":false}]\n"}, "privateGrade": {"exitCode": 1, "output": "[{\"input\":0,\"actual\":0,\"expected\":-2,\"passed\":false},{\"input\":3,\"actual\":6,\"expected\":4,\"passed\":false}]\n"}, "patchDigest": "b630dc8480483919126eaf446376973e3e6977d96ab60e049b3dad73a1a74db7", "partialProgress": {"alignedStates": 4, "lossTransitions": 1, "reusedAfterLoss": 1, "finalAligned": true, "meaning": "requirement-aligned fields, assessed after freeze; not independently verified intermediate repair"}}
{"status": "exhausted", "reason": "limits", "modelRequests": 50, "accountingComplete": true, "unreconciledModelRequests": 0}
```

## public-test-insufficient / responsive / C

```json
{"kind": "public_test", "digest": "5bb579d78c1cda817da5f79ec788e91fffced9440cc98dede96d592f39361c95", "detail": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":0,\"expected\":0,\"passed\":true}]\n", "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}}
{"kind": "action", "digest": "88139ddf8540887ae7f014069ed259e8c5abee2d719df2a6b2dcedac0fed49a5", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"a\": 0", "newText": "\"a\": 1"}}
{"kind": "action", "digest": "af062acbe3e64aa039672b0bc0197abeb443bf0cc9685e7d96ea67d18afdb7d7", "detail": {"action": "test"}}
{"kind": "public_test", "digest": "ff93ac6644fe6d6446449d265b7bea04ade89415e7bcabbff9abd8d6474928ee", "detail": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":0,\"expected\":0,\"passed\":true}]\n", "patchDigest": "0aef085a22bbe02694c04f045300e57c4111ad90f542fb705d83acfc3c8d0aae"}}
{"kind": "decision", "digest": "4cf15dc64a84295a8a5eb27f54320e9894a609d9af33917f645b8b4f3fa56a84", "detail": {"action": "champion", "patchDigest": "0aef085a22bbe02694c04f045300e57c4111ad90f542fb705d83acfc3c8d0aae"}}
{"kind": "action", "digest": "e6eb33a0cb65b8eca0a8d3e1f2e36b594fa9eed3d8d877c3c560b437e9b28e38", "detail": {"action": "finish"}}
{"resolved": false, "gradeStatus": "completed", "freshPublic": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":0,\"expected\":0,\"passed\":true}]\n"}, "privateGrade": {"exitCode": 1, "output": "[{\"input\":2,\"actual\":2,\"expected\":4,\"passed\":false},{\"input\":-2,\"actual\":-2,\"expected\":-4,\"passed\":false}]\n"}, "patchDigest": "0aef085a22bbe02694c04f045300e57c4111ad90f542fb705d83acfc3c8d0aae", "partialProgress": null}
{"status": "finished", "reason": "model_finish", "modelRequests": 5, "accountingComplete": true, "unreconciledModelRequests": 0}
```

## independent-verifier-unavailable / responsive / C

```json
{"kind": "public_test", "digest": "0d7edec76ecaedc9d7f56239c92ffa789b7aceba16f5d88a9971e20a1b7a3ecf", "detail": {"exitCode": 1, "output": "[{\"input\":0,\"actual\":0,\"expected\":2,\"passed\":false}]\n", "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}}
{"kind": "action", "digest": "1af95823a781127ece87cfb6ef69b08687800559967a5223183e230f4398a2ed", "detail": {"action": "edit", "path": "src/settings.json", "oldText": "\"mode\": 0", "newText": "\"mode\": 2"}}
{"kind": "action", "digest": "af062acbe3e64aa039672b0bc0197abeb443bf0cc9685e7d96ea67d18afdb7d7", "detail": {"action": "test"}}
{"kind": "public_test", "digest": "ce80f598865531350ce9f6cc54b2591f2a7f377be42644ac82827eaab2ca8750", "detail": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":2,\"expected\":2,\"passed\":true}]\n", "patchDigest": "429a5be1807285bf6734fbf5934fae04f182a0720c157b3eadea8557c752009d"}}
{"kind": "decision", "digest": "b5441c4e6a2f9405734ae4f3284ca5d2005acb5e3f2d2e2dd71fcfc71892cd89", "detail": {"action": "champion", "patchDigest": "429a5be1807285bf6734fbf5934fae04f182a0720c157b3eadea8557c752009d"}}
{"kind": "action", "digest": "e6eb33a0cb65b8eca0a8d3e1f2e36b594fa9eed3d8d877c3c560b437e9b28e38", "detail": {"action": "finish"}}
{"resolved": false, "gradeStatus": "failed", "freshPublic": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":2,\"expected\":2,\"passed\":true}]\n"}, "privateGrade": null, "patchDigest": "429a5be1807285bf6734fbf5934fae04f182a0720c157b3eadea8557c752009d", "partialProgress": null}
{"status": "finished", "reason": "model_finish", "modelRequests": 5, "accountingComplete": true, "unreconciledModelRequests": 0}
```

## uncertain-accounting / responsive / C

```json
{"kind": "public_test", "digest": "0d7edec76ecaedc9d7f56239c92ffa789b7aceba16f5d88a9971e20a1b7a3ecf", "detail": {"exitCode": 1, "output": "[{\"input\":0,\"actual\":0,\"expected\":2,\"passed\":false}]\n", "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}}
{"kind": "stopped", "digest": "b20b095b20077ec6888bcc8ad73e870e273f6ac48cadc35ef7a4b5193c1262ec", "detail": {"reason": "FIXTURE_UNCERTAIN_DISPATCH"}}
{"resolved": false, "gradeStatus": "blocked", "freshPublic": null, "privateGrade": null, "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "partialProgress": null}
{"status": "failed", "reason": "FIXTURE_UNCERTAIN_DISPATCH", "modelRequests": 2, "accountingComplete": false, "unreconciledModelRequests": 1}
```

