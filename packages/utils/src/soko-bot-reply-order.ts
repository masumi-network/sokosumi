/**
 * When a Soko Bot reply's attempt started (`metadata.soko_bot.attempt_at`).
 *
 * Core writes it on every write of the reply, copied from the attempt that
 * owns the reply at write time and never lowered. Web orders full message
 * events by it, and Core's dispatch measures its give-up budget from it, so
 * an explicit Retry starts a fresh budget.
 */
export function readSokoBotAttemptAt(metadata: unknown): number | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  const sokoBot = (metadata as { soko_bot?: unknown }).soko_bot;
  if (!sokoBot || typeof sokoBot !== "object") return undefined;
  const at = (sokoBot as { attempt_at?: unknown }).attempt_at;
  return typeof at === "number" ? at : undefined;
}

function replyOrder(metadata: unknown): [number, number] | null {
  const at = readSokoBotAttemptAt(metadata);
  if (at === undefined) return null;
  const streaming = (metadata as { streaming?: unknown }).streaming === true;
  return [at, streaming ? 0 : 1];
}

/**
 * Whether a copy of a Soko Bot reply (its metadata `incoming`) is older than
 * the one shown (`known`): an earlier attempt, or "Thinking…" of the same
 * attempt after it settled.
 *
 * Every publisher reads the message and then sends it, so a copy read before
 * a later write can arrive after it: a "Thinking…" read before the turn
 * failed, or an old failed card read before a Retry answered. A fresh Retry's
 * "Thinking…" belongs to a newer attempt and still replaces a failed card.
 * Replies without an attempt keep last-wins.
 */
export function isStaleSokoBotReply(
  known: unknown,
  incoming: unknown,
): boolean {
  const current = replyOrder(known);
  const next = replyOrder(incoming);
  if (!current || !next) return false;
  return (
    next[0] < current[0] || (next[0] === current[0] && next[1] < current[1])
  );
}
