import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { describe, it } from "node:test";
import {
  verifyNicoAutomatedPackage,
  type NicoArtifactIdentity,
  type NicoAutomatedPackage,
} from "../src/nico-automated-package-verifier.ts";

const RUN_ID = "sara-telegram-nico-0123456789abcdef01234567";
const REPOSITORY = "https://github.com/sindresorhus/p-map";
const COMMIT = "22dda61ea29037ba85af25e84bc5efba77e62f44";
const SCHEMA = "nico.authorized-automated-delivery.v1";

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function u16(value: number): Buffer {
  const result = Buffer.alloc(2); result.writeUInt16LE(value); return result;
}
function u32(value: number): Buffer {
  const result = Buffer.alloc(4); result.writeUInt32LE(value); return result;
}

function zip(entries: Array<{ name: string; bytes: Uint8Array; compressed: boolean }>): Uint8Array {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const source = Buffer.from(entry.bytes);
    const data = entry.compressed ? deflateRawSync(source) : source;
    const method = entry.compressed ? 8 : 0;
    const localHeader = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(method), u16(0), u16(0), u32(0),
      u32(data.length), u32(source.length), u16(name.length), u16(0), name, data,
    ]);
    local.push(localHeader);
    central.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(method), u16(0), u16(0), u32(0),
      u32(data.length), u32(source.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
    ]));
    offset += localHeader.length;
  }
  const centralBytes = Buffer.concat(central);
  return new Uint8Array(Buffer.concat([
    ...local,
    centralBytes,
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(centralBytes.length), u32(offset), u16(0),
  ]));
}

function packageFixture(compressed: boolean): { value: NicoAutomatedPackage; identity: NicoArtifactIdentity } {
  const report = new Uint8Array(Buffer.from("%PDF-1.7\nNICO verified automated report\n", "utf8"));
  const manifest = new Uint8Array(Buffer.from(JSON.stringify({
    run_id: RUN_ID,
    repository_url: REPOSITORY,
    commit_sha: COMMIT,
    artifact_schema: SCHEMA,
    authorization: {
      status: "Authorized — Automated Delivery",
      human_reviewed: false,
      disclosure: "Automated delivery. This assessment was not human reviewed.",
    },
    report: {
      path: "report.pdf",
      sha256: sha256(report),
      size_bytes: report.byteLength,
      content_type: "application/pdf",
    },
  })), "utf8"));
  const body = zip([
    { name: "report.pdf", bytes: report, compressed },
    { name: "manifest.json", bytes: manifest, compressed },
  ]);
  const digest = sha256(body);
  const identity = { artifactSchema: SCHEMA, artifactId: "artifact-00000001", revision: 7, sha256: digest, sizeBytes: body.byteLength };
  return {
    identity,
    value: {
      runId: RUN_ID,
      repositoryUrl: REPOSITORY,
      commitSha: COMMIT,
      artifactIdentity: identity,
      authorizationStatus: "Authorized — Automated Delivery",
      humanReviewed: false,
      automatedDeliveryDisclosure: "Automated delivery; no human review was performed.",
      contentType: "application/zip",
      body,
      digest,
    },
  };
}

describe("NICO automated package verifier", () => {
  it("independently verifies stored and deflated ZIP entries, manifest identity, report hash, and package digest", () => {
    for (const compressed of [false, true]) {
      const fixture = packageFixture(compressed);
      const result = verifyNicoAutomatedPackage(fixture.value, {
        runId: RUN_ID,
        repositoryUrl: REPOSITORY,
        commitSha: COMMIT,
        artifactIdentity: fixture.identity,
      });
      assert.equal(result.reportDigest, fixture.value.digest);
      assert.deepEqual(result.reportBytes, fixture.value.body);
      assert.equal(result.humanReviewed, false);
    }
  });

  it("accepts an exact PDF package only when metadata, hash, size, status, and disclosure agree", () => {
    const body = new Uint8Array(Buffer.from("%PDF-1.7\nprivate automated report\n", "utf8"));
    const digest = sha256(body);
    const identity = { artifactSchema: SCHEMA, artifactId: "artifact-00000002", revision: 1, sha256: digest, sizeBytes: body.byteLength };
    const value: NicoAutomatedPackage = {
      runId: RUN_ID,
      repositoryUrl: REPOSITORY,
      commitSha: COMMIT,
      artifactIdentity: identity,
      authorizationStatus: "Authorized — Automated Delivery",
      humanReviewed: false,
      automatedDeliveryDisclosure: "Automated delivery; this report was not human reviewed.",
      contentType: "application/pdf",
      body,
      digest,
    };
    assert.equal(verifyNicoAutomatedPackage(value, { runId: RUN_ID, repositoryUrl: REPOSITORY, commitSha: COMMIT, artifactIdentity: identity }).contentType, "application/pdf");
  });

  it("rejects altered bytes, stale targets, mismatched artifact identity, unresolved disclosure, and human-review claims", () => {
    const fixture = packageFixture(true);
    const expected = { runId: RUN_ID, repositoryUrl: REPOSITORY, commitSha: COMMIT, artifactIdentity: fixture.identity };
    const altered = new Uint8Array(fixture.value.body); altered[10] = altered[10]! ^ 1;
    assert.throws(() => verifyNicoAutomatedPackage({ ...fixture.value, body: altered }, expected), /digest/);
    assert.throws(() => verifyNicoAutomatedPackage({ ...fixture.value, commitSha: "0".repeat(40) }, expected), /commit/);
    assert.throws(() => verifyNicoAutomatedPackage({ ...fixture.value, artifactIdentity: { ...fixture.identity, artifactId: "other" } }, expected), /artifact identity/);
    assert.throws(() => verifyNicoAutomatedPackage({ ...fixture.value, humanReviewed: true }, expected), /human review/);
    assert.throws(() => verifyNicoAutomatedPackage({ ...fixture.value, automatedDeliveryDisclosure: "Automated delivery." }, expected), /disclosure/);
  });
});
