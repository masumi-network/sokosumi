/**
 * Termination rule for bot-to-bot chat.
 *
 * A mention is a contract: a row is written, a placeholder goes up, and a turn
 * fills it. Between two bots that is perpetual motion — both sides behave
 * correctly and the conversation still never ends, because the thing that
 * normally stops one (a person losing interest) is absent.
 *
 * So the brake is structural rather than a matter of what the models decide to
 * say. Every mention carries the number of bot-to-bot hops behind it. A person
 * speaking resets the count; a mention written by a bot's own message inherits
 * its turn's depth plus one. Past the ceiling the message still posts — it is
 * simply no longer a summons, so nobody wakes and the cascade stops.
 */
export const MAX_CHAT_CHAIN_DEPTH = 4;

/** Depth a mention gets when `turnChainDepth`'s turn is the one speaking. */
export function nextChatChainDepth(turnChainDepth: number): number {
  return turnChainDepth + 1;
}

/**
 * Whether a mention at this depth may still wake its target. Human-sent
 * mentions are depth 0 and are never refused here.
 */
export function chatChainMayWake(chainDepth: number): boolean {
  return chainDepth <= MAX_CHAT_CHAIN_DEPTH;
}

/**
 * Bot-authored messages one room accepts per hour, whoever wrote them.
 *
 * Deliberately independent of the hop counter. Depth reasoning is pairwise, so
 * three bots in a triangle can defeat it if a reset is ever wrong; this is the
 * backstop that does not care how the traffic was produced. It bounds noise in
 * a shared room as much as it bounds cost.
 */
export const ROOM_BOT_MESSAGES_PER_HOUR = 20;

export const ROOM_BOT_MESSAGE_WINDOW_MS = 60 * 60 * 1_000;
