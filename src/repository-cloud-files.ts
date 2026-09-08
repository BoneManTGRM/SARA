import { lstat, mkdir, open, readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CLOUD_MAX_BYTES, cloudFields } from "./repository-cloud-protocol.ts";

export interface CloudFile { path: string; content: string }
function pathOK(path: string): boolean {
  return typeof path === "string" && path.length < 500 && /^[A-Za-z0-9_./-]+$/.test(path)
    && path.split("/").every(p => p && p !== "." && p !== "..");
}
/** Only judge output, never the dataset, harness, checkout or process environment. */
export async function collectCloudJudgeFiles(root: string): Promise<CloudFile[]> {
  const files: CloudFile[] = []; let bytes = 0;
  async function walk(relative: string) {
    const path = join(root, relative), stat = await lstat(path);
    if (!pathOK(relative) || stat.isSymbolicLink()) throw Error("CLOUD_FILE_PATH");
    if (stat.isDirectory()) { for (const child of (await readdir(path)).sort()) await walk(`${relative}/${child}`); return; }
    if (!stat.isFile() || files.length >= 100 || bytes + stat.size > CLOUD_MAX_BYTES / 2) throw Error("CLOUD_FILES_SIZE");
    const raw = await readFile(path); const content = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    bytes += raw.length; files.push({ path: relative, content });
  }
  await walk("judge-dispatch.json"); await walk("official-judge"); return files;
}
export async function persistCloudJudgeFiles(root: string, input: unknown): Promise<void> {
  if (!Array.isArray(input) || input.length < 2 || input.length > 100) throw Error("CLOUD_FILES");
  const files = structuredClone(input) as CloudFile[], seen = new Set<string>(); let bytes = 0;
  for (const f of files) {
    cloudFields(f, ["path", "content"]);
    if (!pathOK(f.path) || (f.path !== "judge-dispatch.json" && !f.path.startsWith("official-judge/"))
      || seen.has(f.path) || typeof f.content !== "string") throw Error("CLOUD_FILE_PATH");
    seen.add(f.path); bytes += Buffer.byteLength(f.content);
    if (bytes > CLOUD_MAX_BYTES / 2) throw Error("CLOUD_FILES_SIZE");
  }
  if (!seen.has("judge-dispatch.json") || !seen.has("official-judge/judge-receipt.json")) throw Error("CLOUD_JUDGE_RECEIPT_MISSING");
  for (const f of files) {
    const path = join(root, f.path); await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const handle = await open(path, "wx", 0o600);
    try { await handle.writeFile(f.content); await handle.sync(); } finally { await handle.close(); }
    const parent = await open(dirname(path), "r"); try { await parent.sync(); } finally { await parent.close(); }
  }
}
