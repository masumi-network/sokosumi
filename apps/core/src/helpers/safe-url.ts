const SAFE_REMOTE_URL_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Accept only absolute HTTP(S) URLs for remotely hosted resources.
 * Rejects executable/local schemes like javascript:, data:, and file:.
 */
export function normalizeSafeRemoteUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (!SAFE_REMOTE_URL_PROTOCOLS.has(parsed.protocol)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function isSafeRemoteUrl(value: string): boolean {
  return normalizeSafeRemoteUrl(value) !== null;
}
