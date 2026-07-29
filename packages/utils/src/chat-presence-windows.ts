/** Session idle ≤ this → online (Core presence + web self-approx). */
export const CHAT_PRESENCE_ONLINE_WINDOW_MS = 5 * 60 * 1000;

/** Session idle ≤ this (and past online) → afk; beyond → offline. */
export const CHAT_PRESENCE_AFK_WINDOW_MS = 30 * 60 * 1000;
