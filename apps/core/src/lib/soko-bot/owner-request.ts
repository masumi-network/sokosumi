/**
 * Whether a turn is work its member asked for themselves: the one rule for
 * "the owner's own request" (follow-up grants, web-taint exceptions).
 */
export interface OwnerRequestTurn {
  source: string | null;
  chainDepth: number;
  askedByUserId: string | null;
  requestedByUserId: string | null;
}

/** The turn's member asked it themselves, not a teammate or another bot. */
export function ownerAskedIn(turn: OwnerRequestTurn): boolean {
  return (
    turn.chainDepth === 0 &&
    (turn.askedByUserId === null ||
      turn.askedByUserId === turn.requestedByUserId)
  );
}

/**
 * The owner's own chat turn itself, in the foreground: not a background run
 * of it, a wake, a schedule or anything Core started.
 */
export function isForegroundOwnerChat(
  turn: Omit<OwnerRequestTurn, "askedByUserId"> & {
    askedByUserId?: string | null;
    parentTurnId?: string | null;
  },
): boolean {
  return (
    !turn.parentTurnId &&
    isOwnerRequest({
      ...turn,
      askedByUserId: turn.askedByUserId ?? null,
      parentTurnId: null,
    })
  );
}

/**
 * The owner's own request: their chat, however it was started, or a
 * background run whose parent was their chat. Core's own turns (a mail check,
 * an autonomous production event) can start runs too; those are not.
 * `schedules` also counts a schedule's run, which already holds the tools of
 * whoever wrote it.
 */
export function isOwnerRequest(
  turn: OwnerRequestTurn & {
    parentTurnId: string | null;
    parentTurn?: OwnerRequestTurn | null;
  },
  options: { schedules?: boolean } = {},
): boolean {
  if (turn.parentTurnId) {
    const parent = turn.parentTurn ?? null;
    return (
      ownerAskedIn(turn) &&
      turn.source === "CHAT" &&
      parent !== null &&
      ownerAskedIn(parent) &&
      parent.source === "CHAT"
    );
  }
  return (
    ownerAskedIn(turn) &&
    (turn.source === "CHAT" ||
      (options.schedules === true && turn.source === "SCHEDULE"))
  );
}
