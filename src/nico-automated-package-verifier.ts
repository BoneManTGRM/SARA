import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";

export type NicoArtifactIdentity = {
  artifactSchema: string;
  artifactId: string;
  revision: number;
  sha256: string;
  sizeBytes: number;
};

export type NicoAutomatedPackage = {
  runId: string;
  repositoryUrl: string;
  commitSha: string;
  artifactIdentity: NicoArtifactIdentity;
  authorizationStatus: string;
  humanReviewed: boolean;
  automatedDeliveryDisclosure: string;
  contentType: string;
  body: Uint8Array;
  digest: string;
};

export type VerifiedNicoAutomatedPackage = {
  runId: string;
  repositoryUrl: string;
  commitSha: string;
  artifactIdentity: NicoArtifactIdentity;
  authorizationStatus: "Authorized — Automated Delivery";
  humanReviewed: false;
  contentType: "application/pdf" | "application/zip";
  reportDigest: string;
  reportBytes: Uint8Array;
};

const SHA256 = /^[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const MAX_PACKAGE_BYTES = 50 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 128;
const MAX_ZIP_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertText(value: unknown, label: string, maximum = 512): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) throw new Error(`${label} is missing or invalid.`);
  return value;
}

function canonicalRepositoryUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("The NICO package repository identity is invalid.");
  }
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.search || url.hash || url.username || url.password) {
    throw new Error("The NICO package repository identity is invalid.");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 2) throw new Error("The NICO package repository identity is invalid.");
  return `https://github.com/${parts[0]}/${parts[1]}`;
}

function exactAutomatedDisclosure(value: string): boolean {
  const normalized = value.toLowerCase().replace(/[—–]/gu, "-");
  return normalized.includes("automated") && (normalized.includes("not human reviewed") || normalized.includes("no human review"));
}

function readU16(buffer: Buffer, offset: number): number {
  if (offset < 0 || offset + 2 > buffer.length) throw new Error("The ZIP package is truncated.");
  return buffer.readUInt16LE(offset);
}

function readU32(buffer: Buffer, offset: number): number {
  if (offset < 0 || offset + 4 > buffer.length) throw new Error("The ZIP package is truncated.");
  return buffer.readUInt32LE(offset);
}

function safeZipName(name: string): boolean {
  return name.length > 0
    && name.length <= 512
    && !name.startsWith("/")
    && !name.includes("\\")
    && !name.split("/").some((part) => part === ".." || part === ".");
}

function zipEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  const buffer = Buffer.from(bytes);
  const minimum = Math.max(0, buffer.length - 65_557);
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error("The automated ZIP package has no valid central directory.");
  const disk = readU16(buffer, eocd + 4);
  const centralDisk = readU16(buffer, eocd + 6);
  const entriesOnDisk = readU16(buffer, eocd + 8);
  const entryCount = readU16(buffer, eocd + 10);
  const centralSize = readU32(buffer, eocd + 12);
  const centralOffset = readU32(buffer, eocd + 16);
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount || entryCount < 1 || entryCount > MAX_ZIP_ENTRIES) {
    throw new Error("Multi-disk or oversized ZIP packages are not supported.");
  }
  if (centralOffset + centralSize > eocd) throw new Error("The ZIP central directory is invalid.");
  const result = new Map<string, Uint8Array>();
  let offset = centralOffset;
  let total = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (readU32(buffer, offset) !== 0x02014b50) throw new Error("The ZIP central directory entry is invalid.");
    const flags = readU16(buffer, offset + 8);
    const method = readU16(buffer, offset + 10);
    const compressedSize = readU32(buffer, offset + 20);
    const uncompressedSize = readU32(buffer, offset + 24);
    const nameLength = readU16(buffer, offset + 28);
    const extraLength = readU16(buffer, offset + 30);
    const commentLength = readU16(buffer, offset + 32);
    const localOffset = readU32(buffer, offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if ((flags & 0x1) !== 0 || !safeZipName(name) || result.has(name) || (method !== 0 && method !== 8)) {
      throw new Error("The ZIP package contains an unsafe or unsupported entry.");
    }
    if (readU32(buffer, localOffset) !== 0x04034b50) throw new Error("The ZIP local entry is invalid.");
    const localNameLength = readU16(buffer, localOffset + 26);
    const localExtraLength = readU16(buffer, localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + compressedSize > buffer.length) throw new Error("The ZIP entry data is truncated.");
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    const inflated = method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: uncompressedSize });
    if (inflated.byteLength !== uncompressedSize) throw new Error("The ZIP entry size does not match its manifest.");
    total += inflated.byteLength;
    if (total > MAX_ZIP_UNCOMPRESSED_BYTES) throw new Error("The ZIP package expands beyond the verification limit.");
    result.set(name, new Uint8Array(inflated));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return result;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid.`);
  return value as Record<string, unknown>;
}

function manifestValue(record: Record<string, unknown>, snake: string, camel: string): unknown {
  return record[snake] ?? record[camel];
}

function verifyZipManifest(input: NicoAutomatedPackage): void {
  const entries = zipEntries(input.body);
  const manifests = [...entries].filter(([name]) => name === "manifest.json" || name.endsWith("/manifest.json"));
  if (manifests.length !== 1) throw new Error("The automated package must contain exactly one manifest.json.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(manifests[0]![1]).toString("utf8"));
  } catch {
    throw new Error("The automated package manifest is invalid JSON.");
  }
  const manifest = object(parsed, "The automated package manifest");
  if (manifestValue(manifest, "run_id", "runId") !== input.runId) throw new Error("The package manifest run identity does not match.");
  if (canonicalRepositoryUrl(String(manifestValue(manifest, "repository_url", "repositoryUrl") ?? "")) !== canonicalRepositoryUrl(input.repositoryUrl)) {
    throw new Error("The package manifest repository identity does not match.");
  }
  if (manifestValue(manifest, "commit_sha", "commitSha") !== input.commitSha) throw new Error("The package manifest commit does not match.");
  if (manifestValue(manifest, "artifact_schema", "artifactSchema") !== input.artifactIdentity.artifactSchema) throw new Error("The package artifact schema does not match.");
  const authorization = object(manifest.authorization ?? manifest.delivery, "The automated-delivery manifest authorization");
  if (manifestValue(authorization, "status", "authorizationStatus") !== "Authorized — Automated Delivery") throw new Error("The package is not authorized for automated delivery.");
  if (manifestValue(authorization, "human_reviewed", "humanReviewed") !== false) throw new Error("The automated package may not claim human review.");
  const disclosure = String(manifestValue(authorization, "disclosure", "automatedDeliveryDisclosure") ?? "");
  if (!exactAutomatedDisclosure(disclosure)) throw new Error("The package lacks the automated-delivery disclosure.");
  const report = object(manifest.report, "The automated package report record");
  const reportPath = assertText(manifestValue(report, "path", "file") ?? manifestValue(report, "filename", "fileName"), "The report path");
  const reportBytes = entries.get(reportPath);
  if (!reportBytes) throw new Error("The report named by the package manifest is absent.");
  const expectedDigest = String(manifestValue(report, "sha256", "digest") ?? "");
  const expectedSize = Number(manifestValue(report, "size_bytes", "sizeBytes"));
  if (!SHA256.test(expectedDigest) || sha256(reportBytes) !== expectedDigest || !Number.isSafeInteger(expectedSize) || reportBytes.byteLength !== expectedSize) {
    throw new Error("The report entry hash or size does not match the package manifest.");
  }
}

export function verifyNicoAutomatedPackage(input: NicoAutomatedPackage, expected: {
  runId: string;
  repositoryUrl: string;
  commitSha: string;
  artifactIdentity: NicoArtifactIdentity;
}): VerifiedNicoAutomatedPackage {
  assertText(input.runId, "The NICO run ID");
  if (input.runId !== expected.runId) throw new Error("The NICO package run identity does not match.");
  if (canonicalRepositoryUrl(input.repositoryUrl) !== canonicalRepositoryUrl(expected.repositoryUrl)) throw new Error("The NICO package repository identity does not match.");
  if (!COMMIT.test(input.commitSha) || input.commitSha !== expected.commitSha) throw new Error("The NICO package commit does not match.");
  if (input.artifactIdentity.artifactSchema !== expected.artifactIdentity.artifactSchema
    || input.artifactIdentity.artifactId !== expected.artifactIdentity.artifactId
    || input.artifactIdentity.revision !== expected.artifactIdentity.revision
    || input.artifactIdentity.sha256 !== expected.artifactIdentity.sha256
    || input.artifactIdentity.sizeBytes !== expected.artifactIdentity.sizeBytes) {
    throw new Error("The NICO package artifact identity does not match the terminal run.");
  }
  if (input.authorizationStatus !== "Authorized — Automated Delivery") throw new Error("The NICO package is not authorized for automated delivery.");
  if (input.humanReviewed !== false) throw new Error("The automated NICO path may not claim human review.");
  if (!exactAutomatedDisclosure(input.automatedDeliveryDisclosure)) throw new Error("The NICO package lacks the automated-delivery disclosure.");
  if (input.contentType !== "application/pdf" && input.contentType !== "application/zip") throw new Error("The NICO package content type is not supported.");
  if (!(input.body instanceof Uint8Array) || input.body.byteLength === 0 || input.body.byteLength > MAX_PACKAGE_BYTES) throw new Error("The NICO package body is empty or exceeds the verification limit.");
  if (!SHA256.test(input.digest) || sha256(input.body) !== input.digest) throw new Error("The NICO package digest does not match its bytes.");
  if (input.artifactIdentity.sha256 !== input.digest || input.artifactIdentity.sizeBytes !== input.body.byteLength) {
    throw new Error("The NICO artifact hash-and-size identity does not match the package bytes.");
  }
  if (input.contentType === "application/pdf") {
    if (!Buffer.from(input.body.subarray(0, 5)).equals(Buffer.from("%PDF-"))) throw new Error("The NICO PDF package signature is invalid.");
  } else {
    verifyZipManifest(input);
  }
  return {
    runId: input.runId,
    repositoryUrl: canonicalRepositoryUrl(input.repositoryUrl),
    commitSha: input.commitSha,
    artifactIdentity: { ...input.artifactIdentity },
    authorizationStatus: "Authorized — Automated Delivery",
    humanReviewed: false,
    contentType: input.contentType,
    reportDigest: input.digest,
    reportBytes: new Uint8Array(input.body),
  };
}
