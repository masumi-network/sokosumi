import type { createEmailTranslator } from "../i18n/translate.js";

/**
 * The catalog entries every notification email draws on.
 *
 * The greeting, the link instructions and the stand-in names are the same
 * words whether the email is the notification itself (SOK-1090) or the
 * reminder a day later (SOK-916), so they live under one scope rather than
 * being spelled in each.
 */
export const NOTIFICATION_SHARED_SCOPE = "notifications.shared";

export type TranslateFn = ReturnType<typeof createEmailTranslator>["t"];

/**
 * The reader's name, or a greeting that does without one.
 *
 * Two catalog entries rather than one with an empty name, because "Hi ," is
 * worse in every language than "Hi".
 */
export function buildGreeting(
  t: TranslateFn,
  name: null | string | undefined,
): string {
  const trimmedName = name?.trim();

  if (!trimmedName) {
    return t(`${NOTIFICATION_SHARED_SCOPE}.greetingWithoutName`);
  }

  return t(`${NOTIFICATION_SHARED_SCOPE}.greeting`, { name: trimmedName });
}

/**
 * A name the email can use, or a translated stand-in.
 *
 * The parameters come from the notification, and a row can legitimately be
 * missing one. A subject line reading "needs your input for" with a hole in
 * it would be worse than one that says "Your task", so the hole is filled
 * rather than left.
 */
export function nameOr(
  t: TranslateFn,
  value: null | string | undefined,
  fallbackKey:
    | "fallbackAuthorName"
    | "fallbackCoworkerName"
    | "fallbackRoomName"
    | "fallbackTaskName",
): string {
  const trimmedValue = value?.trim();

  return trimmedValue
    ? trimmedValue
    : t(`${NOTIFICATION_SHARED_SCOPE}.${fallbackKey}`);
}

/** The "or paste this URL" line, the same in every notification email. */
export function linkInstructions(t: TranslateFn): string {
  return t(`${NOTIFICATION_SHARED_SCOPE}.linkInstructions`);
}
