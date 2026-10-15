/**
 * The person a Soko Bot schedule, turn or pending decision acts for: its
 * Requester, the member who asked (ADR 0056). A record the bot started on its
 * own has no Requester, and a personal Soko Bot then acts for its owner, as
 * every personal bot always has.
 */
export function sokoBotActingUserId(record: {
  requestedByUserId: string | null;
  sokoBot: { userId: string };
}): string {
  return record.requestedByUserId ?? record.sokoBot.userId;
}
