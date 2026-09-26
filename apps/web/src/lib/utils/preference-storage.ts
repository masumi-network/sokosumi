/**
 * A reader's small preference, kept in this browser.
 *
 * Every such preference wants the same three things, and each one is a way
 * to lose the feature if it is forgotten: storage that throws in a private
 * window, a server render with no `window`, and a stored value from an older
 * shape of the key. Reading returns `null` for all three, so the caller has
 * one fallback to write instead of four. A value the caller cannot parse is
 * removed rather than read again on every mount.
 *
 * Writing is best-effort: a full quota must never break the feature the
 * preference decorates.
 */
export function readStoredPreference<T>(
  key: string,
  parse: (raw: string) => T | null,
): T | null {
  try {
    if (typeof window === "undefined") {
      return null;
    }
    const raw = window.localStorage.getItem(key);
    if (raw === null) {
      return null;
    }
    const parsed = parse(raw);
    if (parsed === null) {
      window.localStorage.removeItem(key);
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeStoredPreference(key: string, value: string): void {
  try {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(key, value);
  } catch {
    // Best-effort: quota or private mode must not break the feature.
  }
}
