import type { IndexedRuntimeEvent } from "@sokosumi/soko-bot";

// Runtime events after which a drain settles the turn.
export const SETTLEMENT_TRIGGER_EVENT_TYPES = new Set([
  "input.requested",
  "session.waiting",
  "session.completed",
  "session.failed",
]);

const TRANSIENT_RUNTIME_EVENT_TYPES = new Set([
  "action.partial",
  "message.appended",
  "reasoning.appended",
]);

export function shouldPersistSokoBotRuntimeEvent(type: string): boolean {
  return !TRANSIENT_RUNTIME_EVENT_TYPES.has(type);
}

export function matchSokoBotRuntimeTurnBoundary(input: {
  turnStarted: IndexedRuntimeEvent;
  messageReceived: IndexedRuntimeEvent;
  expectedMessage: string;
  alreadyOwned: boolean;
}): string | null {
  if (
    input.turnStarted.event.type !== "turn.started" ||
    input.messageReceived.event.type !== "message.received" ||
    input.alreadyOwned
  ) {
    return null;
  }
  const candidateTurnId = input.turnStarted.event.data.turnId;
  const receivedTurnId = input.messageReceived.event.data.turnId;
  const receivedMessage = input.messageReceived.event.data.message;
  if (
    typeof candidateTurnId !== "string" ||
    candidateTurnId.length === 0 ||
    (receivedTurnId !== undefined && receivedTurnId !== candidateTurnId) ||
    receivedMessage !== input.expectedMessage
  ) {
    return null;
  }
  return candidateTurnId;
}
