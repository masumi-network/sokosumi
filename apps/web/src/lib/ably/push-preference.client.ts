"use client";

let currentSession:
  | { userId: string; sessionId: string; sessionCreatedAt: number }
  | undefined;

const PUSH_PREFERENCE_KEY = "sokosumi.push.preference";

interface PushPreference {
  userId: string;
  suspended: boolean;
  sessionId?: string;
  sessionCreatedAt?: number;
}

function readPreference(): PushPreference | null {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(PUSH_PREFERENCE_KEY) ?? "null",
    );
    if (
      value &&
      typeof value === "object" &&
      "userId" in value &&
      typeof value.userId === "string" &&
      "suspended" in value &&
      typeof value.suspended === "boolean"
    ) {
      return {
        ...("sessionCreatedAt" in value &&
        typeof value.sessionCreatedAt === "number" &&
        Number.isFinite(value.sessionCreatedAt)
          ? { sessionCreatedAt: value.sessionCreatedAt }
          : {}),
        userId: value.userId,
        suspended: value.suspended,
        ...("sessionId" in value && typeof value.sessionId === "string"
          ? { sessionId: value.sessionId }
          : {}),
      };
    }
  } catch {
    // Blocked storage cannot establish consent for automatic recovery.
  }
  return null;
}

export function wantsPushHere(userId: string): boolean {
  const preference = readPreference();
  return preference?.userId === userId && !preference.suspended;
}

export function hasPushPreference(): boolean {
  return readPreference() !== null;
}

export function rememberPushPreference(
  userId: string,
  suspended = false,
): void {
  try {
    const stored = readPreference();
    const previous = stored?.userId === userId ? stored : null;
    const session =
      currentSession?.userId === userId &&
      currentSession.sessionCreatedAt >= (previous?.sessionCreatedAt ?? 0)
        ? currentSession
        : previous;
    localStorage.setItem(
      PUSH_PREFERENCE_KEY,
      JSON.stringify({
        userId,
        suspended,
        sessionId: session?.sessionId,
        sessionCreatedAt: session?.sessionCreatedAt,
      }),
    );
  } catch {
    // The current activation can continue without persistent recovery.
  }
}

export function forgetPushPreference(): void {
  try {
    localStorage.removeItem(PUSH_PREFERENCE_KEY);
  } catch {
    // Storage is unavailable.
  }
}

/** The authenticated shell supplies a non-secret session ID, not a cookie token.
 * A stale tab cannot resume a preference suspended in its own session. */
export function resumePushPreferenceForSession(
  userId: string,
  sessionId: string,
  sessionCreatedAt: number,
): boolean {
  if (!Number.isFinite(sessionCreatedAt)) return false;
  currentSession = { userId, sessionId, sessionCreatedAt };
  const preference = readPreference();
  if (preference?.userId !== userId) return false;
  if (preference.suspended) {
    if (
      !preference.sessionId ||
      preference.sessionId === sessionId ||
      preference.sessionCreatedAt === undefined ||
      sessionCreatedAt <= preference.sessionCreatedAt
    )
      return false;
    rememberPushPreference(userId);
    return true;
  }
  rememberPushPreference(userId);
  return false;
}
