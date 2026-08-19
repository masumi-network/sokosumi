export const SOKO_BOT_ROUTE = "/personal-assistant";
export const ADMIN_SOKO_BOTS_ROUTE = "/admin/soko-bots";

/** Operator actions accepted by Core `POST /admin/soko-bots/{id}/actions`. */
export const ADMIN_SOKO_BOT_ACTIONS = [
  "PAUSE",
  "RESUME",
  "RESET_SESSION",
  "RESET_MEMORY",
  "RETRY_LAST_FAILED",
] as const;

export type AdminSokoBotActionKind = (typeof ADMIN_SOKO_BOT_ACTIONS)[number];

export const ADMIN_SOKO_BOT_SCHEDULE_ACTIONS = [
  "RETRY_SCHEDULE_RUN",
  "DISABLE_SCHEDULE",
] as const;

export type AdminSokoBotScheduleActionKind =
  (typeof ADMIN_SOKO_BOT_SCHEDULE_ACTIONS)[number];

/** Turn statuses that still change; the chat surface keeps polling while any exist. */
export const ACTIVE_SOKO_BOT_TURN_STATUSES = new Set([
  "QUEUED",
  "STARTING",
  "RUNNING",
  "CANCEL_REQUESTED",
]);

/** Action error code when Core answers 409: a turn is still running. */
export const SOKO_BOT_BUSY_ERROR_CODE = "SOKO_BOT_BUSY";
