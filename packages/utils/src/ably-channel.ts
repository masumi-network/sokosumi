/**
 * Ably channel name helpers for real-time communication.
 * These functions are shared by publishers and subscribers and must stay
 * client-safe.
 */

/**
 * The deployment a channel name belongs to. Production keeps the established
 * names; every other deployment is scoped so it can never reach production
 * clients, whose rooms and users a forked database shares (ADR 0055).
 */
export interface RealtimeChannelEnvironment {
  network: "Mainnet" | "Preprod";
  vercelEnv?: "production" | "preview" | "development";
  vercelGitCommitRef?: string;
}

/**
 * Null for production. A preview uses its exact Git ref, URL-encoded so
 * distinct refs cannot collapse onto one sanitized name. Anything else,
 * including a missing environment, is development: unknown fails closed.
 */
function channelScope(environment: RealtimeChannelEnvironment): string | null {
  if (environment.vercelEnv === "production") {
    return null;
  }
  const network = environment.network.toLowerCase();
  if (environment.vercelEnv === "preview") {
    const branchRef = environment.vercelGitCommitRef?.trim();
    if (!branchRef) {
      throw new Error("Preview realtime channels require a Git branch ref");
    }
    return `preview:${network}:branch_${encodeURIComponent(branchRef)}`;
  }
  return `development:${network}`;
}

/**
 * Inserts the scope after the first segment. Ably applies channel rules and
 * key grants (`chat_typing:*`, `presence:org_*`) by that segment, so it never
 * moves.
 */
function scopeChannelName(
  productionName: string,
  environment: RealtimeChannelEnvironment,
): string {
  const scope = channelScope(environment);
  if (scope === null) {
    return productionName;
  }
  const separator = productionName.indexOf(":");
  return `${productionName.slice(0, separator)}:${scope}${productionName.slice(separator)}`;
}

/** The id after `prefix`, or null when the name has another prefix or no id. */
function idAfterPrefix(channelName: string, prefix: string): string | null {
  if (!channelName.startsWith(prefix)) {
    return null;
  }
  const id = channelName.slice(prefix.length);
  return id.length > 0 ? id : null;
}

export function makeAgentJobsChannelName(
  agentId: string,
  userId: string,
  environment: RealtimeChannelEnvironment,
): string {
  return scopeChannelName(
    `agent_jobs:agent_${agentId}:user_${userId}`,
    environment,
  );
}

/**
 * Token capability resource covering every agent's jobs channel for one user:
 * the agent id sits in the middle segment, so the grant is a wildcard there.
 */
export function makeAgentJobsCapabilityResourceName(
  userId: string,
  environment: RealtimeChannelEnvironment,
): string {
  return scopeChannelName(`agent_jobs:*:user_${userId}`, environment);
}

export function makeUserTasksChannelName(
  userId: string,
  environment: RealtimeChannelEnvironment,
): string {
  return scopeChannelName(`tasks:all:user_${userId}`, environment);
}

/**
 * Keeps its shipped shapes: production `notifications:all:user_{id}` and the
 * preview name without `all`. Apple reads it from the token capability by
 * prefix and suffix, so the shape is free to differ from the other channels.
 */
export function makeUserNotificationsChannelName(
  userId: string,
  environment: RealtimeChannelEnvironment,
): string {
  const scope = channelScope(environment);
  if (scope === null) {
    return `notifications:all:user_${userId}`;
  }
  return `notifications:${scope}:user_${userId}`;
}

/**
 * Per-user chat control channel (membership revoke, etc.). Always granted on
 * the subscribe token so remote kicks can signal without room caps (SOK-742).
 */
export function makeUserChatControlChannelName(
  userId: string,
  environment: RealtimeChannelEnvironment,
): string {
  return scopeChannelName(`chat_control:user_${userId}`, environment);
}

export const CALENDAR_INVALIDATED_EVENT_NAME = "calendar_invalidated";
export const CALENDAR_ACCESS_REVOKED_EVENT_NAME = "calendar_access_revoked";

export function makeWorkspaceCalendarChannelName(
  workspaceId: string,
  userId: string,
  environment: RealtimeChannelEnvironment,
): string {
  return scopeChannelName(
    `calendar:workspace_${workspaceId}:user_${userId}`,
    environment,
  );
}

export function makeUserCalendarControlChannelName(
  userId: string,
  environment: RealtimeChannelEnvironment,
): string {
  return scopeChannelName(`calendar_control:user_${userId}`, environment);
}

/** Shared room-scoped channel for chat_room_message fan-out (SOK-741). */
export function makeChatRoomChannelName(
  roomId: string,
  environment: RealtimeChannelEnvironment,
): string {
  return scopeChannelName(`chat_rooms:room_${roomId}`, environment);
}

/**
 * Inverse of {@link makeChatRoomChannelName} for one environment. Returns null
 * for non-room channels, another environment's rooms and an empty id.
 */
export function parseChatRoomIdFromChannelName(
  channelName: string,
  environment: RealtimeChannelEnvironment,
): string | null {
  return idAfterPrefix(channelName, makeChatRoomChannelName("", environment));
}

/**
 * Room-scoped channel carrying Typing only (ADR-0033). Separate from
 * {@link makeChatRoomChannelName} because Ably capabilities are per channel and
 * operation, never per event name: clients publish Typing here so the message
 * channel can stay subscribe-only and a room message cannot be forged.
 */
export function makeChatTypingChannelName(
  roomId: string,
  environment: RealtimeChannelEnvironment,
): string {
  return scopeChannelName(`chat_typing:room_${roomId}`, environment);
}

/** Org-scoped Ably Presence channel (ADR-0003). */
export function makeOrgPresenceChannelName(
  organizationId: string,
  environment: RealtimeChannelEnvironment,
): string {
  return scopeChannelName(`presence:org_${organizationId}`, environment);
}

/**
 * Inverse of {@link makeOrgPresenceChannelName} for one environment. Null when
 * not an org presence channel of that environment or empty org id.
 */
export function parseOrganizationIdFromPresenceChannelName(
  channelName: string,
  environment: RealtimeChannelEnvironment,
): string | null {
  return idAfterPrefix(
    channelName,
    makeOrgPresenceChannelName("", environment),
  );
}
