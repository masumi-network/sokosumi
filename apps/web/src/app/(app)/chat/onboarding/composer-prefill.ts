/**
 * One-shot composer prefill for onboarding → room handoff.
 * Distinct from auto-send pending (`chat-room-pending-message:`).
 *
 * `take` clears sessionStorage but keeps a short-lived memory copy so React
 * Strict Mode double-invoking useState initializers does not drop the draft.
 */
const ROOM_COMPOSER_PREFILL_KEY_PREFIX = "pending-room-composer-draft:";

const recentTakes = new Map<string, { text: string; at: number }>();
const STRICT_MODE_TAKE_WINDOW_MS = 250;

function storageKey(roomId: string): string {
  return `${ROOM_COMPOSER_PREFILL_KEY_PREFIX}${roomId}`;
}

/** Put after ensure succeeds. Best-effort; failure must not block navigation. */
export function stashRoomComposerPrefill(roomId: string, text: string): void {
  const trimmed = text.trim();
  if (!trimmed || typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(storageKey(roomId), trimmed);
    recentTakes.delete(roomId);
  } catch {
    // private mode / quota — room opens with empty composer
  }
}

/** Read-once: returns value and clears storage. Missing/empty → null. */
export function takeRoomComposerPrefill(roomId: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const recent = recentTakes.get(roomId);
  if (recent && Date.now() - recent.at < STRICT_MODE_TAKE_WINDOW_MS) {
    return recent.text;
  }
  try {
    const key = storageKey(roomId);
    const value = window.sessionStorage.getItem(key);
    window.sessionStorage.removeItem(key);
    if (value == null) {
      return null;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }
    recentTakes.set(roomId, { text: trimmed, at: Date.now() });
    return trimmed;
  } catch {
    return null;
  }
}

export function peekRoomComposerPrefill(roomId: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const recent = recentTakes.get(roomId);
  if (recent && Date.now() - recent.at < STRICT_MODE_TAKE_WINDOW_MS) {
    return recent.text;
  }
  try {
    const value = window.sessionStorage.getItem(storageKey(roomId));
    if (value == null) {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}
