# Representative frozen traces

Events below are extracted from repetition 0, without rerunning or editing producer outcomes. Full event and candidate patches remain in results.json and producer-freeze.json.

## affine-zero-invariant / B

```json
{"detail": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":0,\"expected\":0,\"passed\":true}]\n", "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}, "digest": "5bb579d78c1cda817da5f79ec788e91fffced9440cc98dede96d592f39361c95", "kind": "public_test"}
{"detail": {"action": "edit", "newText": "\"a\": 1", "oldText": "\"a\": 0", "path": "src/settings.json"}, "digest": "88139ddf8540887ae7f014069ed259e8c5abee2d719df2a6b2dcedac0fed49a5", "kind": "action"}
{"detail": {"action": "edit", "newText": "\"b\": 1", "oldText": "\"b\": 0", "path": "src/settings.json"}, "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "kind": "action"}
{"detail": {"action": "test"}, "digest": "af062acbe3e64aa039672b0bc0197abeb443bf0cc9685e7d96ea67d18afdb7d7", "kind": "action"}
{"detail": {"exitCode": 1, "output": "[{\"input\":0,\"actual\":1,\"expected\":0,\"passed\":false}]\n", "patchDigest": "ecf9ae5562f473bcdbf9cd0bba8fa3be16c49a9dfdd8892ac0cf01e5486fcd9f"}, "digest": "83513e66c181111325f02dd80a47c6010a0ed85c88be51d5b533f1ca8631213d", "kind": "public_test"}
{"detail": {"baselinePassed": true, "candidateDigest": "ecf9ae5562f473bcdbf9cd0bba8fa3be16c49a9dfdd8892ac0cf01e5486fcd9f", "contextBoundTactics": ["d15cb51736c79e2cfe7a22dd9754f78ef49462df1fa7240820a2d9467c0b4632", "f2f01a9e9e9fc4b56df02bd4919ad3f1462acb47c55f02c885197b20df2d3bd3"], "contextBoundTransitions": ["2b9d9ed7f3254c66a4c7ab61a9b708d404b77869952cd2f1ec533288ebe728a6", "28aec50b56615cc0fde152399c78aeecc8f5f4de20df9a78a6dc7b9f7ca9a697"], "omittedTactics": 0, "omittedTransitions": 0, "testEvidenceDigest": "83513e66c181111325f02dd80a47c6010a0ed85c88be51d5b533f1ca8631213d"}, "digest": "6b39d5e18def26d0554456e4abacd6a99d68055db8cee385b057b9272cbe1fda", "kind": "failure_memory"}
{"detail": {"action": "rollback", "championDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "reason": "new_public_failure"}, "digest": "9205991c54a1be7624a41aa5dc61e263127fa2038111eb636f6e1a266c8e0465", "kind": "decision"}
{"detail": {"recurrence": 1, "repairYield": 0, "strategy": "surgical"}, "digest": "4612a694b2d8b7f34e7aab64f56a9e45171dfabf145fdae4a34ec6fe306358b1", "kind": "strategy"}
{"detail": {"action": "edit", "newText": "\"a\": 1", "oldText": "\"a\": 0", "path": "src/settings.json"}, "digest": "88139ddf8540887ae7f014069ed259e8c5abee2d719df2a6b2dcedac0fed49a5", "kind": "action"}
{"detail": {"action": "suppress_duplicate", "tactic": "d15cb51736c79e2cfe7a22dd9754f78ef49462df1fa7240820a2d9467c0b4632"}, "digest": "5e695094c0037a85215f66c0f1628f8c73f29b37eb1181bb9aef325de1f2d0b4", "kind": "decision"}
{"detail": {"action": "edit", "newText": "\"a\": 1", "oldText": "\"a\": 0", "path": "src/settings.json"}, "digest": "88139ddf8540887ae7f014069ed259e8c5abee2d719df2a6b2dcedac0fed49a5", "kind": "action"}
{"detail": {"action": "suppress_duplicate", "tactic": "d15cb51736c79e2cfe7a22dd9754f78ef49462df1fa7240820a2d9467c0b4632"}, "digest": "5e695094c0037a85215f66c0f1628f8c73f29b37eb1181bb9aef325de1f2d0b4", "kind": "decision"}
{"detail": {"action": "test"}, "digest": "af062acbe3e64aa039672b0bc0197abeb443bf0cc9685e7d96ea67d18afdb7d7", "kind": "action"}
{"detail": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":0,\"expected\":0,\"passed\":true}]\n", "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}, "digest": "5bb579d78c1cda817da5f79ec788e91fffced9440cc98dede96d592f39361c95", "kind": "public_test"}
{"detail": {"action": "champion", "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}, "digest": "a76adc2ccbf002903ca4f4ef4511c25c2aa90deb5ab7f228356d268723797730", "kind": "decision"}
{"detail": {"recurrence": 1, "repairYield": 91743.11926605504, "strategy": "surgical"}, "digest": "00ac310ed68f88d056af714b7f857fd80211a01e809c4755a714e4f9aa4e8473", "kind": "strategy"}
{"detail": {"action": "finish"}, "digest": "e6eb33a0cb65b8eca0a8d3e1f2e36b594fa9eed3d8d877c3c560b437e9b28e38", "kind": "action"}
{"patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "freshPublic": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":0,\"expected\":0,\"passed\":true}]\n"}, "privateGrade": {"exitCode": 1, "output": "[{\"input\":2,\"actual\":0,\"expected\":8,\"passed\":false},{\"input\":-1,\"actual\":0,\"expected\":-4,\"passed\":false}]\n"}, "gradeStatus": "completed", "resolved": false}
{"status": "finished", "reason": "model_finish", "accountingComplete": true, "unreconciledModelRequests": 0}
```

## affine-zero-invariant / C

```json
{"detail": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":0,\"expected\":0,\"passed\":true}]\n", "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}, "digest": "5bb579d78c1cda817da5f79ec788e91fffced9440cc98dede96d592f39361c95", "kind": "public_test"}
{"detail": {"action": "edit", "newText": "\"a\": 1", "oldText": "\"a\": 0", "path": "src/settings.json"}, "digest": "88139ddf8540887ae7f014069ed259e8c5abee2d719df2a6b2dcedac0fed49a5", "kind": "action"}
{"detail": {"action": "edit", "newText": "\"b\": 1", "oldText": "\"b\": 0", "path": "src/settings.json"}, "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "kind": "action"}
{"detail": {"action": "test"}, "digest": "af062acbe3e64aa039672b0bc0197abeb443bf0cc9685e7d96ea67d18afdb7d7", "kind": "action"}
{"detail": {"exitCode": 1, "output": "[{\"input\":0,\"actual\":1,\"expected\":0,\"passed\":false}]\n", "patchDigest": "ecf9ae5562f473bcdbf9cd0bba8fa3be16c49a9dfdd8892ac0cf01e5486fcd9f"}, "digest": "83513e66c181111325f02dd80a47c6010a0ed85c88be51d5b533f1ca8631213d", "kind": "public_test"}
{"detail": {"baselinePassed": true, "candidateDigest": "ecf9ae5562f473bcdbf9cd0bba8fa3be16c49a9dfdd8892ac0cf01e5486fcd9f", "contextBoundTactics": ["d15cb51736c79e2cfe7a22dd9754f78ef49462df1fa7240820a2d9467c0b4632", "f2f01a9e9e9fc4b56df02bd4919ad3f1462acb47c55f02c885197b20df2d3bd3"], "contextBoundTransitions": ["2b9d9ed7f3254c66a4c7ab61a9b708d404b77869952cd2f1ec533288ebe728a6", "28aec50b56615cc0fde152399c78aeecc8f5f4de20df9a78a6dc7b9f7ca9a697"], "omittedTactics": 0, "omittedTransitions": 0, "testEvidenceDigest": "83513e66c181111325f02dd80a47c6010a0ed85c88be51d5b533f1ca8631213d"}, "digest": "6b39d5e18def26d0554456e4abacd6a99d68055db8cee385b057b9272cbe1fda", "kind": "failure_memory"}
{"detail": {"action": "rollback", "championDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "reason": "new_public_failure"}, "digest": "9205991c54a1be7624a41aa5dc61e263127fa2038111eb636f6e1a266c8e0465", "kind": "decision"}
{"detail": {"recurrence": 1, "repairYield": 0, "strategy": "surgical"}, "digest": "4612a694b2d8b7f34e7aab64f56a9e45171dfabf145fdae4a34ec6fe306358b1", "kind": "strategy"}
{"detail": {"action": "edit", "newText": "\"a\": 1", "oldText": "\"a\": 0", "path": "src/settings.json"}, "digest": "88139ddf8540887ae7f014069ed259e8c5abee2d719df2a6b2dcedac0fed49a5", "kind": "action"}
{"detail": {"action": "suppress_duplicate", "tactic": "d15cb51736c79e2cfe7a22dd9754f78ef49462df1fa7240820a2d9467c0b4632"}, "digest": "5e695094c0037a85215f66c0f1628f8c73f29b37eb1181bb9aef325de1f2d0b4", "kind": "decision"}
{"detail": {"action": "edit", "newText": "\"a\": 1", "oldText": "\"a\": 0", "path": "src/settings.json"}, "digest": "88139ddf8540887ae7f014069ed259e8c5abee2d719df2a6b2dcedac0fed49a5", "kind": "action"}
{"detail": {"action": "suppress_duplicate", "tactic": "d15cb51736c79e2cfe7a22dd9754f78ef49462df1fa7240820a2d9467c0b4632"}, "digest": "5e695094c0037a85215f66c0f1628f8c73f29b37eb1181bb9aef325de1f2d0b4", "kind": "decision"}
{"detail": {"action": "test"}, "digest": "af062acbe3e64aa039672b0bc0197abeb443bf0cc9685e7d96ea67d18afdb7d7", "kind": "action"}
{"detail": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":0,\"expected\":0,\"passed\":true}]\n", "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}, "digest": "5bb579d78c1cda817da5f79ec788e91fffced9440cc98dede96d592f39361c95", "kind": "public_test"}
{"detail": {"action": "champion", "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}, "digest": "a76adc2ccbf002903ca4f4ef4511c25c2aa90deb5ab7f228356d268723797730", "kind": "decision"}
{"detail": {"recurrence": 1, "repairYield": 99999.99999999999, "strategy": "surgical"}, "digest": "e054b1df878d6c8a020c2d2db4445c3edd2224737630751ee71539493b8459ac", "kind": "strategy"}
{"detail": {"action": "finish"}, "digest": "e6eb33a0cb65b8eca0a8d3e1f2e36b594fa9eed3d8d877c3c560b437e9b28e38", "kind": "action"}
{"detail": {"action": "reject_finish", "failureEvidenceDigest": "6b39d5e18def26d0554456e4abacd6a99d68055db8cee385b057b9272cbe1fda", "instruction": "The failed repair was rolled back. Public green on the original checkout does not resolve the issue. Try a materially different hypothesis using the remaining original budget, or finish if no justified alternative remains.", "reason": "rollback_restored_unrepaired_baseline", "restoredPatchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}, "digest": "0a86675d5fd8c866101248210b099623e18032bf3169b53f52b0f354dddee044", "kind": "decision"}
{"detail": {"action": "edit", "newText": "\"a\": 4", "oldText": "\"a\": 0", "path": "src/settings.json"}, "digest": "0afa97036489bf171f055f73227a313fcb0751c044e230a764b27af0be2a7785", "kind": "action"}
{"detail": {"action": "test"}, "digest": "af062acbe3e64aa039672b0bc0197abeb443bf0cc9685e7d96ea67d18afdb7d7", "kind": "action"}
{"detail": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":0,\"expected\":0,\"passed\":true}]\n", "patchDigest": "b3b452ff8088b7501c5458938693fa836058c40015ccc9924aab3f6377860907"}, "digest": "e2f51d68705f8c87d54e1c3da6adf7813e67320cae3e86a74d204bc4a18163ff", "kind": "public_test"}
{"detail": {"action": "champion", "patchDigest": "b3b452ff8088b7501c5458938693fa836058c40015ccc9924aab3f6377860907"}, "digest": "34041bac70cf4ebc063d70b5e7c3f162ca3f7e175eebf0d75b88878bf3109633", "kind": "decision"}
{"detail": {"recurrence": 1, "repairYield": 4686.035613870665, "strategy": "surgical"}, "digest": "49c3268db2f90b91631e1d8ea9dcda3b7a06c7b84a1eaac3c15469c9dae99236", "kind": "strategy"}
{"detail": {"action": "finish"}, "digest": "e6eb33a0cb65b8eca0a8d3e1f2e36b594fa9eed3d8d877c3c560b437e9b28e38", "kind": "action"}
{"patchDigest": "b3b452ff8088b7501c5458938693fa836058c40015ccc9924aab3f6377860907", "freshPublic": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":0,\"expected\":0,\"passed\":true}]\n"}, "privateGrade": {"exitCode": 0, "output": "[{\"input\":2,\"actual\":8,\"expected\":8,\"passed\":true},{\"input\":-1,\"actual\":-4,\"expected\":-4,\"passed\":true}]\n"}, "gradeStatus": "completed", "resolved": true}
{"status": "finished", "reason": "model_finish", "accountingComplete": true, "unreconciledModelRequests": 0}
```

## no-alternative / C

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
{"detail": {"recurrence": 1, "repairYield": 99999.99999999999, "strategy": "surgical"}, "digest": "e054b1df878d6c8a020c2d2db4445c3edd2224737630751ee71539493b8459ac", "kind": "strategy"}
{"detail": {"action": "finish"}, "digest": "e6eb33a0cb65b8eca0a8d3e1f2e36b594fa9eed3d8d877c3c560b437e9b28e38", "kind": "action"}
{"detail": {"action": "reject_finish", "failureEvidenceDigest": "e25f57ac83e3dfc6931608521a4eab2c980a4a870ce09d5adaa8abfd6947c748", "instruction": "The failed repair was rolled back. Public green on the original checkout does not resolve the issue. Try a materially different hypothesis using the remaining original budget, or finish if no justified alternative remains.", "reason": "rollback_restored_unrepaired_baseline", "restoredPatchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}, "digest": "a94f4396f04f22628a9a91e1ca0a5fbbf55e508dee86cc5c9b67675ceee25460", "kind": "decision"}
{"detail": {"action": "finish"}, "digest": "e6eb33a0cb65b8eca0a8d3e1f2e36b594fa9eed3d8d877c3c560b437e9b28e38", "kind": "action"}
{"patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "freshPublic": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":0,\"expected\":[0,2],\"passed\":true}]\n"}, "privateGrade": {"exitCode": 1, "output": "[{\"input\":0,\"actual\":0,\"expected\":2,\"passed\":false}]\n"}, "gradeStatus": "completed", "resolved": false}
{"status": "finished", "reason": "model_finish", "accountingComplete": true, "unreconciledModelRequests": 0}
```

## ignores-rejection / C

```json
{"detail": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":0,\"expected\":0,\"passed\":true}]\n", "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}, "digest": "5bb579d78c1cda817da5f79ec788e91fffced9440cc98dede96d592f39361c95", "kind": "public_test"}
{"detail": {"action": "edit", "newText": "\"a\": 1", "oldText": "\"a\": 0", "path": "src/settings.json"}, "digest": "88139ddf8540887ae7f014069ed259e8c5abee2d719df2a6b2dcedac0fed49a5", "kind": "action"}
{"detail": {"action": "edit", "newText": "\"b\": 1", "oldText": "\"b\": 0", "path": "src/settings.json"}, "digest": "4c2173bc6d1e727daed14c9c81c766b3463baf9775bcc75e8993688e74dd1517", "kind": "action"}
{"detail": {"action": "test"}, "digest": "af062acbe3e64aa039672b0bc0197abeb443bf0cc9685e7d96ea67d18afdb7d7", "kind": "action"}
{"detail": {"exitCode": 1, "output": "[{\"input\":0,\"actual\":1,\"expected\":0,\"passed\":false}]\n", "patchDigest": "ecf9ae5562f473bcdbf9cd0bba8fa3be16c49a9dfdd8892ac0cf01e5486fcd9f"}, "digest": "83513e66c181111325f02dd80a47c6010a0ed85c88be51d5b533f1ca8631213d", "kind": "public_test"}
{"detail": {"baselinePassed": true, "candidateDigest": "ecf9ae5562f473bcdbf9cd0bba8fa3be16c49a9dfdd8892ac0cf01e5486fcd9f", "contextBoundTactics": ["d15cb51736c79e2cfe7a22dd9754f78ef49462df1fa7240820a2d9467c0b4632", "f2f01a9e9e9fc4b56df02bd4919ad3f1462acb47c55f02c885197b20df2d3bd3"], "contextBoundTransitions": ["2b9d9ed7f3254c66a4c7ab61a9b708d404b77869952cd2f1ec533288ebe728a6", "28aec50b56615cc0fde152399c78aeecc8f5f4de20df9a78a6dc7b9f7ca9a697"], "omittedTactics": 0, "omittedTransitions": 0, "testEvidenceDigest": "83513e66c181111325f02dd80a47c6010a0ed85c88be51d5b533f1ca8631213d"}, "digest": "6b39d5e18def26d0554456e4abacd6a99d68055db8cee385b057b9272cbe1fda", "kind": "failure_memory"}
{"detail": {"action": "rollback", "championDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "reason": "new_public_failure"}, "digest": "9205991c54a1be7624a41aa5dc61e263127fa2038111eb636f6e1a266c8e0465", "kind": "decision"}
{"detail": {"recurrence": 1, "repairYield": 0, "strategy": "surgical"}, "digest": "4612a694b2d8b7f34e7aab64f56a9e45171dfabf145fdae4a34ec6fe306358b1", "kind": "strategy"}
{"detail": {"action": "edit", "newText": "\"a\": 1", "oldText": "\"a\": 0", "path": "src/settings.json"}, "digest": "88139ddf8540887ae7f014069ed259e8c5abee2d719df2a6b2dcedac0fed49a5", "kind": "action"}
{"detail": {"action": "suppress_duplicate", "tactic": "d15cb51736c79e2cfe7a22dd9754f78ef49462df1fa7240820a2d9467c0b4632"}, "digest": "5e695094c0037a85215f66c0f1628f8c73f29b37eb1181bb9aef325de1f2d0b4", "kind": "decision"}
{"detail": {"action": "edit", "newText": "\"a\": 1", "oldText": "\"a\": 0", "path": "src/settings.json"}, "digest": "88139ddf8540887ae7f014069ed259e8c5abee2d719df2a6b2dcedac0fed49a5", "kind": "action"}
{"detail": {"action": "suppress_duplicate", "tactic": "d15cb51736c79e2cfe7a22dd9754f78ef49462df1fa7240820a2d9467c0b4632"}, "digest": "5e695094c0037a85215f66c0f1628f8c73f29b37eb1181bb9aef325de1f2d0b4", "kind": "decision"}
{"detail": {"action": "test"}, "digest": "af062acbe3e64aa039672b0bc0197abeb443bf0cc9685e7d96ea67d18afdb7d7", "kind": "action"}
{"detail": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":0,\"expected\":0,\"passed\":true}]\n", "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}, "digest": "5bb579d78c1cda817da5f79ec788e91fffced9440cc98dede96d592f39361c95", "kind": "public_test"}
{"detail": {"action": "champion", "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}, "digest": "a76adc2ccbf002903ca4f4ef4511c25c2aa90deb5ab7f228356d268723797730", "kind": "decision"}
{"detail": {"recurrence": 1, "repairYield": 90909.09090909091, "strategy": "surgical"}, "digest": "dff776d67e88868201db7e93278fbc7ef2e8d246778877aa90fb864a844d316d", "kind": "strategy"}
{"detail": {"action": "finish"}, "digest": "e6eb33a0cb65b8eca0a8d3e1f2e36b594fa9eed3d8d877c3c560b437e9b28e38", "kind": "action"}
{"detail": {"action": "reject_finish", "failureEvidenceDigest": "6b39d5e18def26d0554456e4abacd6a99d68055db8cee385b057b9272cbe1fda", "instruction": "The failed repair was rolled back. Public green on the original checkout does not resolve the issue. Try a materially different hypothesis using the remaining original budget, or finish if no justified alternative remains.", "reason": "rollback_restored_unrepaired_baseline", "restoredPatchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}, "digest": "0a86675d5fd8c866101248210b099623e18032bf3169b53f52b0f354dddee044", "kind": "decision"}
{"detail": {"action": "finish"}, "digest": "e6eb33a0cb65b8eca0a8d3e1f2e36b594fa9eed3d8d877c3c560b437e9b28e38", "kind": "action"}
{"patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "freshPublic": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":0,\"expected\":0,\"passed\":true}]\n"}, "privateGrade": {"exitCode": 1, "output": "[{\"input\":2,\"actual\":0,\"expected\":8,\"passed\":false}]\n"}, "gradeStatus": "completed", "resolved": false}
{"status": "finished", "reason": "model_finish", "accountingComplete": true, "unreconciledModelRequests": 0}
```

## public-pass-unresolved / C

```json
{"detail": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":0,\"expected\":0,\"passed\":true}]\n", "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}, "digest": "5bb579d78c1cda817da5f79ec788e91fffced9440cc98dede96d592f39361c95", "kind": "public_test"}
{"detail": {"action": "edit", "newText": "\"a\": 1", "oldText": "\"a\": 0", "path": "src/settings.json"}, "digest": "88139ddf8540887ae7f014069ed259e8c5abee2d719df2a6b2dcedac0fed49a5", "kind": "action"}
{"detail": {"action": "test"}, "digest": "af062acbe3e64aa039672b0bc0197abeb443bf0cc9685e7d96ea67d18afdb7d7", "kind": "action"}
{"detail": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":0,\"expected\":0,\"passed\":true}]\n", "patchDigest": "0aef085a22bbe02694c04f045300e57c4111ad90f542fb705d83acfc3c8d0aae"}, "digest": "ff93ac6644fe6d6446449d265b7bea04ade89415e7bcabbff9abd8d6474928ee", "kind": "public_test"}
{"detail": {"action": "champion", "patchDigest": "0aef085a22bbe02694c04f045300e57c4111ad90f542fb705d83acfc3c8d0aae"}, "digest": "4cf15dc64a84295a8a5eb27f54320e9894a609d9af33917f645b8b4f3fa56a84", "kind": "decision"}
{"detail": {"recurrence": 0, "repairYield": 4812.319538017324, "strategy": "surgical"}, "digest": "e12c0ebeb5bc51a50402edd82d10c7088ca6be88d76d5a3350cb4b75bcaf15d5", "kind": "strategy"}
{"detail": {"action": "finish"}, "digest": "e6eb33a0cb65b8eca0a8d3e1f2e36b594fa9eed3d8d877c3c560b437e9b28e38", "kind": "action"}
{"patchDigest": "0aef085a22bbe02694c04f045300e57c4111ad90f542fb705d83acfc3c8d0aae", "freshPublic": {"exitCode": 0, "output": "[{\"input\":0,\"actual\":0,\"expected\":0,\"passed\":true}]\n"}, "privateGrade": {"exitCode": 1, "output": "[{\"input\":2,\"actual\":2,\"expected\":8,\"passed\":false}]\n"}, "gradeStatus": "completed", "resolved": false}
{"status": "finished", "reason": "model_finish", "accountingComplete": true, "unreconciledModelRequests": 0}
```

## uncertain-call / C

```json
{"detail": {"exitCode": 1, "output": "[{\"input\":0,\"actual\":0,\"expected\":2,\"passed\":false}]\n", "patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}, "digest": "0d7edec76ecaedc9d7f56239c92ffa789b7aceba16f5d88a9971e20a1b7a3ecf", "kind": "public_test"}
{"patchDigest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "freshPublic": null, "privateGrade": null, "gradeStatus": "blocked", "resolved": false}
{"status": "failed", "reason": "FIXTURE_UNCERTAIN_DISPATCH", "accountingComplete": false, "unreconciledModelRequests": 1}
```
