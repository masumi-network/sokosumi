import { CHAT_PRESENCE_ONLINE_WINDOW_MS } from "./chat-presence-windows.js";

/** Ably Realtime clientId: `{userId}:{instanceId}` for multi-device presence. */
export const ABLY_PRESENCE_CLIENT_ID_SEPARATOR = ":";

/** Browser/tab instance id for multi-device Ably clientId (opaque, stable per tab). */
export const ABLY_CLIENT_INSTANCE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export type ChatPresenceState = "online" | "afk" | "offline";

/** Wire data on Ably Presence members (ADR-0002). */
export interface ChatPresenceMemberData {
  /** Epoch ms of last user activity on this connection. */
  lastActiveAt: number;
  /** False when document is hidden → AFK even if recently active. */
  visible: boolean;
}

export function isValidAblyClientInstanceId(instanceId: string): boolean {
  return ABLY_CLIENT_INSTANCE_ID_PATTERN.test(instanceId);
}

export function buildAblyPresenceClientId(
  userId: string,
  instanceId: string,
): string {
  return `${userId}${ABLY_PRESENCE_CLIENT_ID_SEPARATOR}${instanceId}`;
}

/**
 * Extract userId from presence clientId. Rejects malformed ids so peers cannot
 * spoof via free-form clientId (token still binds the full clientId).
 */
export function parseUserIdFromAblyPresenceClientId(
  clientId: string,
): string | null {
  const separatorIndex = clientId.indexOf(ABLY_PRESENCE_CLIENT_ID_SEPARATOR);
  if (separatorIndex <= 0) {
    return null;
  }
  const userId = clientId.slice(0, separatorIndex);
  const instanceId = clientId.slice(separatorIndex + 1);
  if (!userId || !isValidAblyClientInstanceId(instanceId)) {
    return null;
  }
  return userId;
}

export function parseChatPresenceMemberData(
  data: unknown,
): ChatPresenceMemberData | null {
  if (data == null || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }
  const record = data as Record<string, unknown>;
  const lastActiveAt = record.lastActiveAt;
  const visible = record.visible;
  if (typeof lastActiveAt !== "number" || !Number.isFinite(lastActiveAt)) {
    return null;
  }
  if (typeof visible !== "boolean") {
    return null;
  }
  return { lastActiveAt, visible };
}

export interface PresenceConnectionInput {
  clientId: string;
  data: unknown;
}

/**
 * Aggregate multi-device Ably presence members into per-user Online/AFK/Offline.
 * Any device online → online; any device connected otherwise → afk; none → offline.
 */
export function aggregateChatPresenceByUserId(
  members: readonly PresenceConnectionInput[],
  nowMs: number = Date.now(),
  onlineWindowMs: number = CHAT_PRESENCE_ONLINE_WINDOW_MS,
): Map<string, ChatPresenceState> {
  const byUser = new Map<string, ChatPresenceState>();

  for (const member of members) {
    const userId = parseUserIdFromAblyPresenceClientId(member.clientId);
    if (userId == null) {
      continue;
    }

    const parsed = parseChatPresenceMemberData(member.data);
    const next: ChatPresenceState =
      parsed != null &&
      parsed.visible &&
      nowMs - parsed.lastActiveAt <= onlineWindowMs
        ? "online"
        : "afk";

    const previous = byUser.get(userId);
    if (previous === "online") {
      continue;
    }
    if (next === "online" || previous == null) {
      byUser.set(userId, next);
    }
  }

  return byUser;
}

export function resolveUserChatPresence(
  members: readonly PresenceConnectionInput[],
  userId: string,
  nowMs: number = Date.now(),
  onlineWindowMs: number = CHAT_PRESENCE_ONLINE_WINDOW_MS,
): ChatPresenceState {
  return (
    aggregateChatPresenceByUserId(members, nowMs, onlineWindowMs).get(userId) ??
    "offline"
  );
}
