# Representative frozen traces

Events below are extracted from repetition 0, without rerunning or editing producer outcomes. Full event and candidate patches remain in results.json and producer-freeze.json.

## affine-prerequisites / B

```json
{"detail": {"exitCode": 1, "output": "[{\"input\":1,\"actual\":0,\"expected\":5,\"passed\":false},{\"input\":2,\"actual\":0,\"expected\":7,\"passed\":false}]\n", "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}, "digest": "7176759aca2fe07c54ffc26b6fcac86ba83ae2b8116c8e126821f30f56268099", "kind": "public_test"}
{"detail": {"action": "edit", "newText": "\"a\": 2", "oldText": "\"a\": 0", "path": "src/settings.json"}, "digest": "fb8193ad0968195e4f4d9ab9271567685c84c66f05c0122364da6ff3afe14f2a", "kind": "action"}
{"detail": {"action": "test"}, "digest": "af062acbe3e64aa039672b0bc0197abeb443bf0cc9685e7d96ea67d18afdb7d7", "kind": "action"}
{"detail": {"exitCode": 1, "output": "[{\"input\":1,\"actual\":2,\"expected\":5,\"passed\":false},{\"input\":2,\"actual\":4,\"expected\":7,\"passed\":false}]\n", "patchDigest": "b630dc8480483919126eaf446376973e3e6977d96ab60e049b3dad73a1a74db7"}, "digest": "c97e1726996c5a1eafd9e14ba1fa6c7250baad619e1f3bcfd7a76f35bc3c881e", "kind": "public_test"}
{"detail": {"recurrence": 1, "repairYield": 0, "strategy": "surgical"}, "digest": "4612a694b2d8b7f34e7aab64f56a9e45171dfabf145fdae4a34ec6fe306358b1", "kind": "strategy"}
{"detail": {"action": "edit", "newText": "\"a\": 0", "oldText": "\"a\": 2", "path": "src/settings.json"}, "digest": "75d186d95edb090ae8dcc0b2d6cbe18d8d64d2603cc9612f6dfc79fa686e598a", "kind": "action"}
{"detail": {"action": "edit", "newText": "\"b\": 3", "oldText": "\"b\": 0", "path": "src/settings.json"}, "digest": "21adad15e22ffb0b319af504056b10781bbe524c590350882fe31dfc17a0c20d", "kind": "action"}
{"detail": {"action": "test"}, "digest": "af062acbe3e64aa039672b0bc0197abeb443bf0cc9685e7d96ea67d18afdb7d7", "kind": "action"}
{"detail": {"exitCode": 1, "output": "[{\"input\":1,\"actual\":3,\"expected\":5,\"passed\":false},{\"input\":2,\"actual\":3,\"expected\":7,\"passed\":false}]\n", "patchDigest": "935d38404f6453492e34fb2a3f71f8922d5644a1b8f1bd53b432aa1add74f13f"}, "digest": "bdc35261c3c40a05234583e5b3a09748a7c1b61340d8560ce8b08a8116cfe666", "kind": "public_test"}
{"detail": {"recurrence": 2, "repairYield": 0, "strategy": "deep"}, "digest": "83c8bdcaf112cbb01f088691a13f36925e28a7fcb13e9eb2787b600c81f19b7b", "kind": "strategy"}
{"detail": {"action": "edit", "newText": "\"a\": 2", "oldText": "\"a\": 0", "path": "src/settings.json"}, "digest": "fb8193ad0968195e4f4d9ab9271567685c84c66f05c0122364da6ff3afe14f2a", "kind": "action"}
{"detail": {"action": "suppress_duplicate", "tactic": "fb8193ad0968195e4f4d9ab9271567685c84c66f05c0122364da6ff3afe14f2a"}, "digest": "961e2f6274470547c3ff7bb007e1e306944eb18155aa3471c74cfbb48d317baf", "kind": "decision"}
{"detail": {"action": "edit", "newText": "\"a\": 2", "oldText": "\"a\": 0", "path": "src/settings.json"}, "digest": "fb8193ad0968195e4f4d9ab9271567685c84c66f05c0122364da6ff3afe14f2a", "kind": "action"}
{"detail": {"action": "suppress_duplicate", "tactic": "fb8193ad0968195e4f4d9ab9271567685c84c66f05c0122364da6ff3afe14f2a"}, "digest": "961e2f6274470547c3ff7bb007e1e306944eb18155aa3471c74cfbb48d317baf", "kind": "decision"}
{"detail": {"action": "test"}, "digest": "af062acbe3e64aa039672b0bc0197abeb443bf0cc9685e7d96ea67d18afdb7d7", "kind": "action"}
{"detail": {"exitCode": 1, "output": "[{\"input\":1,\"actual\":3,\"expected\":5,\"passed\":false},{\"input\":2,\"actual\":3,\"expected\":7,\"passed\":false}]\n", "patchDigest": "935d38404f6453492e34fb2a3f71f8922d5644a1b8f1bd53b432aa1add74f13f"}, "digest": "bdc35261c3c40a05234583e5b3a09748a7c1b61340d8560ce8b08a8116cfe666", "kind": "public_test"}
{"detail": {"recurrence": 3, "repairYield": 0, "strategy": "deep"}, "digest": "281044a560227a380cf280107be7234efb19e633735ec36647eb4e5339570447", "kind": "strategy"}
{"detail": {"action": "finish"}, "digest": "e6eb33a0cb65b8eca0a8d3e1f2e36b594fa9eed3d8d877c3c560b437e9b28e38", "kind": "action"}
{"patchDigest": "935d38404f6453492e34fb2a3f71f8922d5644a1b8f1bd53b432aa1add74f13f", "freshPublic": {"exitCode": 1, "output": "[{\"input\":1,\"actual\":3,\"expected\":5,\"passed\":false},{\"input\":2,\"actual\":3,\"expected\":7,\"passed\":false}]\n"}, "privateGrade": {"exitCode": 1, "output": "[{\"input\":0,\"actual\":3,\"expected\":3,\"passed\":true},{\"input\":-2,\"actual\":3,\"expected\":-1,\"passed\":false}]\n"}, "gradeStatus": "completed", "resolved": false}
{"status": "finished", "reason": "model_finish", "accountingComplete": true, "unreconciledModelRequests": 0}
```

## affine-prerequisites / C

```json
{"detail": {"exitCode": 1, "output": "[{\"input\":1,\"actual\":0,\"expected\":5,\"passed\":false},{\"input\":2,\"actual\":0,\"expected\":7,\"passed\":false}]\n", "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}, "digest": "7176759aca2fe07c54ffc26b6fcac86ba83ae2b8116c8e126821f30f56268099", "kind": "public_test"}
{"detail": {"action": "edit", "newText": "\"a\": 2", "oldText": "\"a\": 0", "path": "src/settings.json"}, "digest": "fb8193ad0968195e4f4d9ab9271567685c84c66f05c0122364da6ff3afe14f2a", "kind": "action"}
{"detail": {"action": "test"}, "digest": "af062acbe3e64aa039672b0bc0197abeb443bf0cc9685e7d96ea67d18afdb7d7", "kind": "action"}
{"detail": {"exitCode": 1, "output": "[{\"input\":1,\"actual\":2,\"expected\":5,\"passed\":false},{\"input\":2,\"actual\":4,\"expected\":7,\"passed\":false}]\n", "patchDigest": "b630dc8480483919126eaf446376973e3e6977d96ab60e049b3dad73a1a74db7"}, "digest": "c97e1726996c5a1eafd9e14ba1fa6c7250baad619e1f3bcfd7a76f35bc3c881e", "kind": "public_test"}
{"detail": {"baselinePassed": false, "candidateDigest": "b630dc8480483919126eaf446376973e3e6977d96ab60e049b3dad73a1a74db7", "contextBoundTactics": ["a375d7447174ed3e216dafe3ccfeff6a0d98229ae5e3b3a273c9116e738e3ebb"], "contextBoundTransitions": ["e2e1e1d5a0299f47ce2156ef6c9a1d34fd0ee338fca6b1089cbc74fc8c6c0902"], "omittedTactics": 0, "omittedTransitions": 0, "testEvidenceDigest": "c97e1726996c5a1eafd9e14ba1fa6c7250baad619e1f3bcfd7a76f35bc3c881e"}, "digest": "65fd302743e1ce92a77d45a2dc08e764d91a41bf5feb75e00472674cf07b400f", "kind": "failure_memory"}
{"detail": {"recurrence": 1, "repairYield": 0, "strategy": "surgical"}, "digest": "4612a694b2d8b7f34e7aab64f56a9e45171dfabf145fdae4a34ec6fe306358b1", "kind": "strategy"}
{"detail": {"action": "edit", "newText": "\"a\": 0", "oldText": "\"a\": 2", "path": "src/settings.json"}, "digest": "75d186d95edb090ae8dcc0b2d6cbe18d8d64d2603cc9612f6dfc79fa686e598a", "kind": "action"}
{"detail": {"action": "edit", "newText": "\"b\": 3", "oldText": "\"b\": 0", "path": "src/settings.json"}, "digest": "21adad15e22ffb0b319af504056b10781bbe524c590350882fe31dfc17a0c20d", "kind": "action"}
{"detail": {"action": "test"}, "digest": "af062acbe3e64aa039672b0bc0197abeb443bf0cc9685e7d96ea67d18afdb7d7", "kind": "action"}
{"detail": {"exitCode": 1, "output": "[{\"input\":1,\"actual\":3,\"expected\":5,\"passed\":false},{\"input\":2,\"actual\":3,\"expected\":7,\"passed\":false}]\n", "patchDigest": "935d38404f6453492e34fb2a3f71f8922d5644a1b8f1bd53b432aa1add74f13f"}, "digest": "bdc35261c3c40a05234583e5b3a09748a7c1b61340d8560ce8b08a8116cfe666", "kind": "public_test"}
{"detail": {"baselinePassed": false, "candidateDigest": "935d38404f6453492e34fb2a3f71f8922d5644a1b8f1bd53b432aa1add74f13f", "contextBoundTactics": ["3fdacc22e3ca48e5cdfdcffc9a6fc4d2cb0017eae036c62c9fdafe09aa9280c9", "474ae5a534e4b261ec2f6edb07c34f5d0bc5be8f9e4ea85f61289fc84cd7fc1e"], "contextBoundTransitions": ["670637a03957f49585af6f0d2c2dbe78f2817b62ac42eddd54c1041cf13730df", "c42bdb4f592f609d24f91ff839efacedb786b9462c3e573d1ced5018aef5eb5f"], "omittedTactics": 0, "omittedTransitions": 0, "testEvidenceDigest": "bdc35261c3c40a05234583e5b3a09748a7c1b61340d8560ce8b08a8116cfe666"}, "digest": "14ecf2d042a6031e781d3ffa2f49922f45fc305ca93ff5fbedf1d7462a10f6c5", "kind": "failure_memory"}
{"detail": {"recurrence": 2, "repairYield": 0, "strategy": "deep"}, "digest": "83c8bdcaf112cbb01f088691a13f36925e28a7fcb13e9eb2787b600c81f19b7b", "kind": "strategy"}
{"detail": {"action": "edit", "newText": "\"a\": 2", "oldText": "\"a\": 0", "path": "src/settings.json"}, "digest": "fb8193ad0968195e4f4d9ab9271567685c84c66f05c0122364da6ff3afe14f2a", "kind": "action"}
{"detail": {"action": "test"}, "digest": "af062acbe3e64aa039672b0bc0197abeb443bf0cc9685e7d96ea67d18afdb7d7", "kind": "action"}
{"detail": {"exitCode": 0, "output": "[{\"input\":1,\"actual\":5,\"expected\":5,\"passed\":true},{\"input\":2,\"actual\":7,\"expected\":7,\"passed\":true}]\n", "patchDigest": "edb7d862b5955d1a15c9571dd40f5a14770e0043e7383b68af91f72158eb7046"}, "digest": "f7f5ea16a54c4b9933e3d7962104690afc5f5b41a13b86ed0b7111fac7beb064", "kind": "public_test"}
{"detail": {"action": "champion", "patchDigest": "edb7d862b5955d1a15c9571dd40f5a14770e0043e7383b68af91f72158eb7046"}, "digest": "4616c32641d8bd58cc4667a1fbf4b674a2bd2216cbddfcd0f0f1b53cf1899a3a", "kind": "decision"}
{"detail": {"recurrence": 2, "repairYield": 4655.493482309124, "strategy": "deep"}, "digest": "8dc91921d065742a984dddf566a313694846c17629983157e75083b768834f50", "kind": "strategy"}
{"detail": {"action": "finish"}, "digest": "e6eb33a0cb65b8eca0a8d3e1f2e36b594fa9eed3d8d877c3c560b437e9b28e38", "kind": "action"}
{"patchDigest": "edb7d862b5955d1a15c9571dd40f5a14770e0043e7383b68af91f72158eb7046", "freshPublic": {"exitCode": 0, "output": "[{\"input\":1,\"actual\":5,\"expected\":5,\"passed\":true},{\"input\":2,\"actual\":7,\"expected\":7,\"passed\":true}]\n"}, "privateGrade": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":3,\"expected\":3,\"passed\":true},{\"input\":-2,\"actual\":-1,\"expected\":-1,\"passed\":true}]\n"}, "gradeStatus": "completed", "resolved": true}
{"status": "finished", "reason": "model_finish", "accountingComplete": true, "unreconciledModelRequests": 0}
```

## regression-alternative / C

```json
{"detail": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":0,\"expected\":[0,2],\"passed\":true}]\n", "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}, "digest": "dfaa4b5aef6e57234f7ff514f88568222a980f21dcb5694e7c0147999126c397", "kind": "public_test"}
{"detail": {"action": "edit", "newText": "\"mode\": 1", "oldText": "\"mode\": 0", "path": "src/settings.json"}, "digest": "65f7f02536437be446a9d5b5c14351a2a5e3bff975cb03f2cb5b497ed70e7bf3", "kind": "action"}
{"detail": {"action": "test"}, "digest": "af062acbe3e64aa039672b0bc0197abeb443bf0cc9685e7d96ea67d18afdb7d7", "kind": "action"}
{"detail": {"exitCode": 1, "output": "[{\"input\":0,\"actual\":1,\"expected\":[0,2],\"passed\":false}]\n", "patchDigest": "6f140882527353160efba6353dc04ee565a65b3d64328bfc1e4b28c8da4ada67"}, "digest": "a6c9ea81d05dcfa5a5b996a514987d4ecbd3b95fdd4290d92bf620861e659c59", "kind": "public_test"}
{"detail": {"baselinePassed": true, "candidateDigest": "6f140882527353160efba6353dc04ee565a65b3d64328bfc1e4b28c8da4ada67", "contextBoundTactics": ["89e76983bcd334baae5410fa3c243bc6c7b5d776bfa64753cae61bcd671c8988"], "contextBoundTransitions": ["4848e0bb7b0f99df0f7106dadd7aaf90a50e122047fc84de5a7ccb07d525e892"], "omittedTactics": 0, "omittedTransitions": 0, "testEvidenceDigest": "a6c9ea81d05dcfa5a5b996a514987d4ecbd3b95fdd4290d92bf620861e659c59"}, "digest": "e25f57ac83e3dfc6931608521a4eab2c980a4a870ce09d5adaa8abfd6947c748", "kind": "failure_memory"}
{"detail": {"action": "rollback", "championDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "reason": "new_public_failure"}, "digest": "9205991c54a1be7624a41aa5dc61e263127fa2038111eb636f6e1a266c8e0465", "kind": "decision"}
{"detail": {"recurrence": 1, "repairYield": 0, "strategy": "surgical"}, "digest": "4612a694b2d8b7f34e7aab64f56a9e45171dfabf145fdae4a34ec6fe306358b1", "kind": "strategy"}
{"detail": {"action": "edit", "newText": "\"mode\": 2", "oldText": "\"mode\": 0", "path": "src/settings.json"}, "digest": "1af95823a781127ece87cfb6ef69b08687800559967a5223183e230f4398a2ed", "kind": "action"}
{"detail": {"action": "test"}, "digest": "af062acbe3e64aa039672b0bc0197abeb443bf0cc9685e7d96ea67d18afdb7d7", "kind": "action"}
{"detail": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":2,\"expected\":[0,2],\"passed\":true}]\n", "patchDigest": "429a5be1807285bf6734fbf5934fae04f182a0720c157b3eadea8557c752009d"}, "digest": "81c94d4da8afc523b71caa4dc1b8d360c2e05ada0431a24cc6c438fc7105fd7d", "kind": "public_test"}
{"detail": {"action": "champion", "patchDigest": "429a5be1807285bf6734fbf5934fae04f182a0720c157b3eadea8557c752009d"}, "digest": "b5441c4e6a2f9405734ae4f3284ca5d2005acb5e3f2d2e2dd71fcfc71892cd89", "kind": "decision"}
{"detail": {"recurrence": 1, "repairYield": 4692.632566870014, "strategy": "surgical"}, "digest": "21de552048577e14217f49e020c2d18e961b86d3cfc13f631ec4ddf16683233d", "kind": "strategy"}
{"detail": {"action": "finish"}, "digest": "e6eb33a0cb65b8eca0a8d3e1f2e36b594fa9eed3d8d877c3c560b437e9b28e38", "kind": "action"}
{"patchDigest": "429a5be1807285bf6734fbf5934fae04f182a0720c157b3eadea8557c752009d", "freshPublic": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":2,\"expected\":[0,2],\"passed\":true}]\n"}, "privateGrade": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":2,\"expected\":2,\"passed\":true}]\n"}, "gradeStatus": "completed", "resolved": true}
{"status": "finished", "reason": "model_finish", "accountingComplete": true, "unreconciledModelRequests": 0}
```

## repeated-regression / C

```json
{"detail": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":0,\"expected\":[0,2],\"passed\":true}]\n", "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}, "digest": "dfaa4b5aef6e57234f7ff514f88568222a980f21dcb5694e7c0147999126c397", "kind": "public_test"}
{"detail": {"action": "edit", "newText": "\"mode\": 1", "oldText": "\"mode\": 0", "path": "src/settings.json"}, "digest": "65f7f02536437be446a9d5b5c14351a2a5e3bff975cb03f2cb5b497ed70e7bf3", "kind": "action"}
{"detail": {"action": "test"}, "digest": "af062acbe3e64aa039672b0bc0197abeb443bf0cc9685e7d96ea67d18afdb7d7", "kind": "action"}
{"detail": {"exitCode": 1, "output": "[{\"input\":0,\"actual\":1,\"expected\":[0,2],\"passed\":false}]\n", "patchDigest": "6f140882527353160efba6353dc04ee565a65b3d64328bfc1e4b28c8da4ada67"}, "digest": "a6c9ea81d05dcfa5a5b996a514987d4ecbd3b95fdd4290d92bf620861e659c59", "kind": "public_test"}
{"detail": {"baselinePassed": true, "candidateDigest": "6f140882527353160efba6353dc04ee565a65b3d64328bfc1e4b28c8da4ada67", "contextBoundTactics": ["89e76983bcd334baae5410fa3c243bc6c7b5d776bfa64753cae61bcd671c8988"], "contextBoundTransitions": ["4848e0bb7b0f99df0f7106dadd7aaf90a50e122047fc84de5a7ccb07d525e892"], "omittedTactics": 0, "omittedTransitions": 0, "testEvidenceDigest": "a6c9ea81d05dcfa5a5b996a514987d4ecbd3b95fdd4290d92bf620861e659c59"}, "digest": "e25f57ac83e3dfc6931608521a4eab2c980a4a870ce09d5adaa8abfd6947c748", "kind": "failure_memory"}
{"detail": {"action": "rollback", "championDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "reason": "new_public_failure"}, "digest": "9205991c54a1be7624a41aa5dc61e263127fa2038111eb636f6e1a266c8e0465", "kind": "decision"}
{"detail": {"recurrence": 1, "repairYield": 0, "strategy": "surgical"}, "digest": "4612a694b2d8b7f34e7aab64f56a9e45171dfabf145fdae4a34ec6fe306358b1", "kind": "strategy"}
{"detail": {"action": "edit", "newText": "\"mode\": 1", "oldText": "\"mode\": 0", "path": "src/settings.json"}, "digest": "65f7f02536437be446a9d5b5c14351a2a5e3bff975cb03f2cb5b497ed70e7bf3", "kind": "action"}
{"detail": {"action": "suppress_duplicate", "tactic": "89e76983bcd334baae5410fa3c243bc6c7b5d776bfa64753cae61bcd671c8988"}, "digest": "10544d8fe776fb21097512267b3788485f1409596be14c63f8499a61cc4793c6", "kind": "decision"}
{"detail": {"action": "edit", "newText": "\"mode\": 1", "oldText": "\"mode\": 0", "path": "src/settings.json"}, "digest": "65f7f02536437be446a9d5b5c14351a2a5e3bff975cb03f2cb5b497ed70e7bf3", "kind": "action"}
{"detail": {"action": "suppress_duplicate", "tactic": "89e76983bcd334baae5410fa3c243bc6c7b5d776bfa64753cae61bcd671c8988"}, "digest": "10544d8fe776fb21097512267b3788485f1409596be14c63f8499a61cc4793c6", "kind": "decision"}
{"detail": {"action": "test"}, "digest": "af062acbe3e64aa039672b0bc0197abeb443bf0cc9685e7d96ea67d18afdb7d7", "kind": "action"}
{"detail": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":0,\"expected\":[0,2],\"passed\":true}]\n", "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}, "digest": "dfaa4b5aef6e57234f7ff514f88568222a980f21dcb5694e7c0147999126c397", "kind": "public_test"}
{"detail": {"action": "champion", "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}, "digest": "a76adc2ccbf002903ca4f4ef4511c25c2aa90deb5ab7f228356d268723797730", "kind": "decision"}
{"detail": {"recurrence": 1, "repairYield": 90090.09009009009, "strategy": "surgical"}, "digest": "c186ff5c371acf5a0e809bfcd8f0fd92b37f55868a0f1b970a4416503ec2f3c7", "kind": "strategy"}
{"detail": {"action": "finish"}, "digest": "e6eb33a0cb65b8eca0a8d3e1f2e36b594fa9eed3d8d877c3c560b437e9b28e38", "kind": "action"}
{"patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "freshPublic": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":0,\"expected\":[0,2],\"passed\":true}]\n"}, "privateGrade": {"exitCode": 1, "output": "[{\"input\":0,\"actual\":0,\"expected\":2,\"passed\":false}]\n"}, "gradeStatus": "completed", "resolved": false}
{"status": "finished", "reason": "model_finish", "accountingComplete": true, "unreconciledModelRequests": 0}
```

## public-green-hidden-bug / C

```json
{"detail": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":0,\"expected\":0,\"passed\":true}]\n", "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}, "digest": "5bb579d78c1cda817da5f79ec788e91fffced9440cc98dede96d592f39361c95", "kind": "public_test"}
{"detail": {"action": "edit", "newText": "\"a\": 1", "oldText": "\"a\": 0", "path": "src/settings.json"}, "digest": "88139ddf8540887ae7f014069ed259e8c5abee2d719df2a6b2dcedac0fed49a5", "kind": "action"}
{"detail": {"action": "test"}, "digest": "af062acbe3e64aa039672b0bc0197abeb443bf0cc9685e7d96ea67d18afdb7d7", "kind": "action"}
{"detail": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":0,\"expected\":0,\"passed\":true}]\n", "patchDigest": "0aef085a22bbe02694c04f045300e57c4111ad90f542fb705d83acfc3c8d0aae"}, "digest": "ff93ac6644fe6d6446449d265b7bea04ade89415e7bcabbff9abd8d6474928ee", "kind": "public_test"}
{"detail": {"action": "champion", "patchDigest": "0aef085a22bbe02694c04f045300e57c4111ad90f542fb705d83acfc3c8d0aae"}, "digest": "4cf15dc64a84295a8a5eb27f54320e9894a609d9af33917f645b8b4f3fa56a84", "kind": "decision"}
{"detail": {"recurrence": 0, "repairYield": 4782.400765184122, "strategy": "surgical"}, "digest": "8ad6daea845e708a158738fca5ad4642f374a6f770bb0e661c86345ddb90538e", "kind": "strategy"}
{"detail": {"action": "finish"}, "digest": "e6eb33a0cb65b8eca0a8d3e1f2e36b594fa9eed3d8d877c3c560b437e9b28e38", "kind": "action"}
{"patchDigest": "0aef085a22bbe02694c04f045300e57c4111ad90f542fb705d83acfc3c8d0aae", "freshPublic": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":0,\"expected\":0,\"passed\":true}]\n"}, "privateGrade": {"exitCode": 1, "output": "[{\"input\":2,\"actual\":2,\"expected\":3,\"passed\":false}]\n"}, "gradeStatus": "completed", "resolved": false}
{"status": "finished", "reason": "model_finish", "accountingComplete": true, "unreconciledModelRequests": 0}
```

## uncertain-dispatch / C

```json
{"detail": {"exitCode": 1, "output": "[{\"input\":0,\"actual\":0,\"expected\":2,\"passed\":false}]\n", "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}, "digest": "0d7edec76ecaedc9d7f56239c92ffa789b7aceba16f5d88a9971e20a1b7a3ecf", "kind": "public_test"}
{"patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "freshPublic": null, "privateGrade": null, "gradeStatus": "blocked", "resolved": false}
{"status": "failed", "reason": "FIXTURE_UNCERTAIN_DISPATCH", "accountingComplete": false, "unreconciledModelRequests": 1}
```
