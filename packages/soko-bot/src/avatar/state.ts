/** What the live avatar shows, most important first. */
export const AVATAR_STATES = [
  "sleeping",
  "error",
  "needs_you",
  "working",
  "thinking",
  "done",
  "idle",
] as const;
export type AvatarState = (typeof AVATAR_STATES)[number];

/** How long the avatar celebrates a finished turn. */
export const AVATAR_DONE_MS = 10_000;

export interface AvatarStateSignals {
  /** `SokoBotStatus`. */
  status?: "IDLE" | "RUNNING" | "PAUSED" | "ERROR" | null;
  /** `SokoBotTurnStatus` of the active or latest turn. */
  turnStatus?:
    | "QUEUED"
    | "STARTING"
    | "RUNNING"
    | "CANCEL_REQUESTED"
    | "COMPLETED"
    | "CANCELLED"
    | "FAILED"
    | null;
  pendingDecisions?: number;
  /** A chat reply is streaming. */
  streaming?: boolean;
  /** When the latest turn finished (ms). */
  finishedAt?: number | null;
  now?: number;
}

export function avatarStateOf(s: AvatarStateSignals): AvatarState {
  if (s.status === "PAUSED") return "sleeping";
  if (s.status === "ERROR" || s.turnStatus === "FAILED") return "error";
  if ((s.pendingDecisions ?? 0) > 0) return "needs_you";
  if (
    s.streaming ||
    s.turnStatus === "RUNNING" ||
    s.turnStatus === "CANCEL_REQUESTED"
  )
    return "working";
  if (s.turnStatus === "QUEUED" || s.turnStatus === "STARTING")
    return "thinking";
  // The sidebar only knows the bot is running, not its turn.
  if (!s.turnStatus && s.status === "RUNNING") return "working";
  if (
    s.finishedAt != null &&
    (s.now ?? Date.now()) - s.finishedAt < AVATAR_DONE_MS
  )
    return "done";
  return "idle";
}
