/**
 * One-shot composer prefill for onboarding → room handoff.
 * Distinct from auto-send pending (`chat-room-pending-message:`).
 */
const ROOM_COMPOSER_PREFILL_KEY_PREFIX = "pending-room-composer-draft:";

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
  } catch {
    // private mode / quota — room opens with empty composer
  }
}

/** Read-once: returns value and clears. Missing/empty → null. */
export function takeRoomComposerPrefill(roomId: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const key = storageKey(roomId);
    const value = window.sessionStorage.getItem(key);
    window.sessionStorage.removeItem(key);
    if (value == null) {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

export function peekRoomComposerPrefill(roomId: string): string | null {
  if (typeof window === "undefined") {
    return null;
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
