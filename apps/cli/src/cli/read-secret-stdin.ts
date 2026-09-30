export function readSecretStdin(signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    const chunks: Buffer[] = [];
    let size = 0;
    const cleanup = () => {
      input.off("data", onData);
      input.off("end", onEnd);
      input.off("error", onError);
      input.off("close", onClose);
      signal.removeEventListener("abort", onAbort);
      input.pause();
    };
    const fail = (message: string) => {
      cleanup();
      reject(new Error(message));
    };
    const onData = (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > 16_384) {
        fail("Secret input exceeds the size limit");
        return;
      }
      chunks.push(bytes);
    };
    const onEnd = () => {
      cleanup();
      try {
        resolve(
          new TextDecoder("utf-8", { fatal: true }).decode(
            Buffer.concat(chunks),
          ),
        );
      } catch {
        reject(new Error("Secret input must contain valid UTF-8 text"));
      }
    };
    const onError = () => fail("Could not read secret input");
    const onClose = () => fail("Secret input closed before completion");
    const onAbort = () => fail("Secret input was aborted or timed out");
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    input.once("end", onEnd);
    input.once("error", onError);
    input.once("close", onClose);
    input.on("data", onData);
  });
}
