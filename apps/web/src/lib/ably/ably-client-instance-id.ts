import { isValidAblyClientInstanceId } from "@sokosumi/utils";

const STORAGE_KEY = "sokosumi.ablyClientInstanceId";

function createInstanceId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replaceAll("-", "").slice(0, 16);
  }
  return `inst_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Stable per-tab Ably client instance id (sessionStorage). Used as token
 * clientId suffix for multi-device presence aggregation (ADR-0002).
 */
export function getOrCreateAblyClientInstanceId(): string {
  if (typeof window === "undefined") {
    return "ssr00000";
  }

  try {
    const existing = window.sessionStorage.getItem(STORAGE_KEY);
    if (existing && isValidAblyClientInstanceId(existing)) {
      return existing;
    }
    const created = createInstanceId();
    const normalized = isValidAblyClientInstanceId(created)
      ? created
      : `inst_${created}`.slice(0, 64);
    window.sessionStorage.setItem(STORAGE_KEY, normalized);
    return normalized;
  } catch {
    return createInstanceId().slice(0, 16).padEnd(8, "0");
  }
}
