/** A definitive client rejection did not commit; transport/server failures may have. */
export function isTableRejection(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "error" in error &&
    [
      "BadRequest",
      "Unauthorized",
      "Forbidden",
      "NotFound",
      "Conflict",
      "UnprocessableEntity",
    ].includes(String(error.error))
  );
}

/** Keep exact input and key until acknowledgement; never reinterpret an ambiguous attempt. */
export function createTableMutations() {
  const attempts = new Map<string, { key: string; fingerprint: string }>();
  return async function mutate<T extends object, R>(
    slot: string,
    body: T,
    send: (request: T & { key: string }) => Promise<R>,
  ): Promise<R> {
    const fingerprint = JSON.stringify(body);
    const previous = attempts.get(slot);
    if (previous && previous.fingerprint !== fingerprint)
      throw new Error("Resolve the previous request before changing its input");
    const attempt = previous ?? { key: crypto.randomUUID(), fingerprint };
    attempts.set(slot, attempt);
    try {
      const result = await send({ ...body, key: attempt.key });
      attempts.delete(slot);
      return result;
    } catch (error) {
      if (isTableRejection(error)) attempts.delete(slot);
      throw error;
    }
  };
}
