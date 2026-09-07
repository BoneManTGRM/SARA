import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
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


const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
export function productionPackage(runId: string, commitSha: string) {
 const identity = {schema: "nico.review_artifact_identity.v1", run_id: runId, revision: 3, report_artifact_digest: "a".repeat(64), artifact_digests: {pdf: "b".repeat(64)}};
 const authorization = {artifact_schema: "nico.comprehensive_automated_delivery.v1", status: "authorized", authorization_mode: "automated_policy", human_reviewed: false, security_certification: false, source_report_artifact_digest: identity.report_artifact_digest, run_id: runId, repository: "sindresorhus/p-map", commit_sha: commitSha};
 const entries = [
 {name:"01_nico_comprehensive_report.pdf",bytes:Buffer.from("%PDF-1.7\nauthorized automated report\n"),compressed:true},
 {name:"02_nico_comprehensive_report.json",bytes:Buffer.from(JSON.stringify({human_review_completed:false,client_delivery_allowed:true,client_facing_status:"authorized_automated_technical_assessment",authorized_delivery:authorization})),compressed:true},
 {name:"07_automated_authorization.json",bytes:Buffer.from(JSON.stringify(authorization)),compressed:true}];
 const manifest = {...authorization, client_facing_status: "authorized_automated_technical_assessment",client_delivery_allowed:true,human_review_required:false, artifacts: entries.map(e=>({path:e.name,sha256:hash(e.bytes),size_bytes:e.bytes.length}))};
 entries.push({name:"08_manifest.json", bytes:Buffer.from(JSON.stringify(manifest)),compressed:true});
 const body=zip(entries); return {body,digest:hash(body),contentType:"application/zip",identity};
}
