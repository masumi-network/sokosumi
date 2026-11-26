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
        // The monotonic clock: a wall clock set back would extend the deadline.
        const end = performance.now() + ms;
        // A deadline past the longest timer waits in steps; Infinity never ends.
        const wait = () => {
          const left = end - performance.now();
          if (left > 0) timer = setTimeout(wait, Math.min(left, MAX_TIMER_MS));
          else reject(new Error(message));
        };
        wait();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
