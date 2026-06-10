export class ClientTimeoutError extends Error {
  constructor(message = "Operation timed out") {
    super(message);
    this.name = "ClientTimeoutError";
  }
}

export function raceWithTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new ClientTimeoutError());
    }, ms);
  });

  return Promise.race([
    promise.finally(() => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }),
    timeoutPromise,
  ]);
}
