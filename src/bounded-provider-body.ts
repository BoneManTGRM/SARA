/** Read a provider response with an allocation bound and the caller's deadline.
 * This does not retry or interpret token usage; a partial response is never success.
 */
export async function readBoundedProviderBody(response: Response, signal?: AbortSignal | null, maximumBytes = 1_048_576): Promise<string> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 1_048_576) throw new Error("PROVIDER_BODY_INVALID_LIMIT");
  if (signal?.aborted) throw new Error("PROVIDER_BODY_ABORTED");
  if (!response.body) throw new Error("PROVIDER_BODY_MISSING");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0, done = false, rejectAbort!: (error: Error) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(new Error("PROVIDER_BODY_ABORTED"));
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    // Cover a signal already aborted between the first check and listener setup.
    if (signal?.aborted) onAbort();
    while (true) {
      const part = await Promise.race([reader.read(), aborted]);
      if (part.done) { done = true; break; }
      if (!(part.value instanceof Uint8Array)) throw new Error("PROVIDER_BODY_INVALID_CHUNK");
      total += part.value.byteLength;
      if (total > maximumBytes) throw new Error("PROVIDER_BODY_BOUND");
      chunks.push(Uint8Array.from(part.value));
    }
    const bytes = Buffer.concat(chunks, total);
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (!done) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
