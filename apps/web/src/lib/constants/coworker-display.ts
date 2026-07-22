/** Minimum length for coworker display name (matches Core schema). */
export const COWORKER_NAME_MIN_LENGTH = 3;

/** Matches Core coworker caption max length. */
export const COWORKER_CAPTION_MAX_LENGTH = 255;

/** @deprecated Use COWORKER_NAME_MIN_LENGTH */
export const ADMIN_COWORKER_NAME_MIN_LENGTH = COWORKER_NAME_MIN_LENGTH;

/** @deprecated Use COWORKER_CAPTION_MAX_LENGTH */
export const ADMIN_COWORKER_CAPTION_MAX_LENGTH = COWORKER_CAPTION_MAX_LENGTH;

/** Platform coworker capabilities editable from admin (matches Core). */
export const ADMIN_COWORKER_CAPABILITIES = ["chat", "tasks"] as const;

export type AdminCoworkerCapability =
  (typeof ADMIN_COWORKER_CAPABILITIES)[number];
