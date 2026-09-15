/** Orders this tab's notification read writes and rejects superseded responses. */
export function createNotificationReadQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  const latest = new Map<string, symbol>();
  let all = Symbol();

  function enqueue<T>(
    ids: string[] | null,
    operation: (isCurrent: (id: string) => boolean) => Promise<T>,
  ): Promise<T> {
    const token = Symbol();
    if (ids === null) all = token;
    else for (const id of ids) latest.set(id, token);
    const allAtStart = all;
    const result = tail.then(() =>
      operation((id) => all === allAtStart && latest.get(id) === token),
    );
    // A failed write must not block the reader's next action.
    tail = result.catch(() => {});
    void tail.then(() => {
      for (const id of ids ?? []) {
        if (latest.get(id) === token) latest.delete(id);
      }
    });
    return result;
  }

  return { enqueue };
}
