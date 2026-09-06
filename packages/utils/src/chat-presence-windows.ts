/**
 * Connected + last activity within this window → online; else still connected
 * → AFK. Offline is disconnect-only (Ably Presence), not idle aging.
 * Used by Ably presence member data + local self-approx.
 */
export const CHAT_PRESENCE_ONLINE_WINDOW_MS = 5 * 60 * 1000;
