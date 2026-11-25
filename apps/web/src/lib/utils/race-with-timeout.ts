export class ClientTimeoutError extends Error {
  constructor(message = "Operation timed out") {
    super(message);
    this.name = "ClientTimeoutError";
  }
}

export function raceWithTimeout<T>(
  promise: Promise<T>,
  ms: number,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) {
    return Promise.reject(
      signal.reason ?? new DOMException("Aborted", "AbortError"),
    );
  }
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const clear = () => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
    if (onAbort) {
      signal?.removeEventListener("abort", onAbort);
      onAbort = undefined;
    }
  };
  const timeoutPromise = new Promise<never>((_, reject) => {
    onAbort = () => {
      clear();
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    timeoutId = setTimeout(() => {
      clear();
      reject(new ClientTimeoutError());
    }, ms);
  });

  return Promise.race([promise.finally(clear), timeoutPromise]);
}
