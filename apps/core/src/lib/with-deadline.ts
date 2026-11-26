/** setTimeout fires at once for a longer delay. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * The work's result, or a rejection once `ms` pass. The work itself is not
 * cancelled: the caller stops waiting for it.
 */
export async function withDeadline<T>(
  work: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  // A deadline already past fails at once, even for work that is done.
  if (!(ms > 0)) {
    work.catch(() => {});
    throw new Error(message);
  }
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(message)),
          Math.min(ms, MAX_TIMER_MS),
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
