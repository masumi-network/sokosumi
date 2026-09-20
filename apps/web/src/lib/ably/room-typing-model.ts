/**
 * Typing: who is composing a message to this room's main transcript right now,
 * and whether to say that you are (ADR-0033).
 *
 * Pure and clock-injected, so every timing case is plain input: no Ably, no
 * React, no timers. Mirrors the org presence split one level down, where
 * `shouldPublishOrgPresenceUpdate` is the same kind of decision function.
 */

/** Ably Chat's own default: one heartbeat per typist per throttle window. */
export const TYPING_HEARTBEAT_THROTTLE_MS = 10_000;

/** Ably's 2s grace on top, so a slow typist never flickers off mid-sentence. */
const TYPING_EXPIRY_GRACE_MS = 2_000;

/**
 * A typist with no heartbeat for this long is gone. The explicit `stopped`
 * event is an optimisation; this window is what makes a closed tab or a
 * dropped connection clear itself, so a lost stop self-heals.
 */
export const TYPING_EXPIRY_MS =
  TYPING_HEARTBEAT_THROTTLE_MS + TYPING_EXPIRY_GRACE_MS;

/** What a typing event says: they picked it up, or they put it down. */
export type TypingState = "started" | "stopped";

export const TYPING_STATES: readonly TypingState[] = ["started", "stopped"];

export interface TypingEvent {
  userId: string;
  state: TypingState;
  atMs: number;
}

interface Typist {
  userId: string;
  /** Kept across heartbeats so the line does not resort under the reader. */
  startedAtMs: number;
  lastHeartbeatMs: number;
}

export type TypingSet = readonly Typist[];

export const EMPTY_TYPING_SET: TypingSet = [];

/**
 * Fold one event into the set. Keyed by user, not by Ably client id, so the
 * same person on a laptop and a phone is one typist. Your own id is never
 * recorded: a room tells you about other people.
 */
export function applyTypingEvent(
  current: TypingSet,
  event: TypingEvent,
  selfUserId: string,
): TypingSet {
  if (event.userId === selfUserId) {
    return current;
  }

  if (event.state === "stopped") {
    const next = current.filter((typist) => typist.userId !== event.userId);
    return next.length === current.length ? current : next;
  }

  const existing = current.find((typist) => typist.userId === event.userId);
  if (existing) {
    return current.map((typist) =>
      typist.userId === event.userId
        ? { ...typist, lastHeartbeatMs: event.atMs }
        : typist,
    );
  }

  return [
    ...current,
    {
      userId: event.userId,
      startedAtMs: event.atMs,
      lastHeartbeatMs: event.atMs,
    },
  ];
}

export type TypingPublishAction = "start" | "stop" | "none";

export interface TypingPublishInput {
  composerHasText: boolean;
  /** When we last told the room we are typing; null when we are not announced. */
  startedPublishedAtMs: number | null;
  nowMs: number;
}

/**
 * What the composer should publish after a genuine input event. Restoring a
 * Draft is not one, which is why opening a room you abandoned a Draft in stays
 * silent: the caller simply does not ask.
 *
 * Send, blur and leaving the room stop directly rather than coming through
 * here — they are not composer content changes.
 */
export function nextTypingPublishAction(
  input: TypingPublishInput,
): TypingPublishAction {
  if (!input.composerHasText) {
    return input.startedPublishedAtMs == null ? "none" : "stop";
  }
  if (input.startedPublishedAtMs == null) {
    return "start";
  }
  return input.nowMs - input.startedPublishedAtMs >=
    TYPING_HEARTBEAT_THROTTLE_MS
    ? "start"
    : "none";
}

/**
 * Same people in the same order. Callers hold typist lists in React state, so
 * an equal-but-new array must not count as a change: replacing state on every
 * recompute re-renders forever.
 */
export function sameTypistIds(
  a: readonly string[],
  b: readonly string[],
): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/** Who is typing at `nowMs`, in the order they started. */
export function liveTypistIds(
  current: TypingSet,
  nowMs: number,
): readonly string[] {
  return current
    .filter((typist) => nowMs - typist.lastHeartbeatMs < TYPING_EXPIRY_MS)
    .map((typist) => typist.userId);
}
