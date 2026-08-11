/**
 * Connected + last activity within this window → online; else still connected
 * → AFK. Offline is disconnect-only (Ably Presence), not idle aging.
 * Used by Ably presence member data + local self-approx.
 */
export const CHAT_PRESENCE_ONLINE_WINDOW_MS = 5 * 60 * 1000;

/**
 * @deprecated Idle no longer ages to offline (ADR-0003). Kept so older imports
 * compile; do not use for Offline classification.
 */
export const CHAT_PRESENCE_AFK_WINDOW_MS = 30 * 60 * 1000;
