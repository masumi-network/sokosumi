/** Expected rejection at an export resource boundary. */
export class ExportLimitError extends Error {
  constructor(
    message: string,
    readonly status = 413,
  ) {
    super(message);
    this.name = "ExportLimitError";
  }
}

/** Stop waiting when canceled. The caller must also stop the underlying work. */
export function awaitExportStep<T>(
  work: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    function abort() {
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    }
    work.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) reject(signal.reason);
        else resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(signal.aborted ? signal.reason : error);
      },
    );
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}
