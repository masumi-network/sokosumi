/**
 * Timing for desktop chat rail "ready" coordination (`data-chat-rail-ready`).
 * Shared by ChatRail (sets the attribute) and consumers such as TasksEmptyStateOverlay
 * (advances guide / connector). Keep a single source of truth so poll interval and
 * fallback timeout stay aligned.
 */
export const CHAT_RAIL_READY_POLL_MS = 50;
export const CHAT_RAIL_READY_TIMEOUT_MS = 3000;
