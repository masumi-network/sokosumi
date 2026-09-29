import type { ReactNode } from "react";
import { Link } from "react-email";

import type { createEmailTranslator } from "../i18n/translate.js";
import { DARK_CLASS, LIGHT_PALETTE } from "../theme/index.js";

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
export type RichFn = ReturnType<typeof createEmailTranslator>["rich"];

function SettingsLink({ children, url }: { children: ReactNode; url: string }) {
  return (
    <Link
      className={DARK_CLASS.link}
      href={url}
      style={{ color: LIGHT_PALETTE.link, textDecoration: "underline" }}
    >
      {children}
    </Link>
  );
}

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
    | "fallbackTaskName"
    | "fallbackProjectName",
): string {
  const trimmedValue = value?.trim();

  return trimmedValue
    ? trimmedValue
    : t(`${NOTIFICATION_SHARED_SCOPE}.${fallbackKey}`);
}

/**
 * The footer note, with `<settings>` resolved.
 *
 * The phrase is linked when the caller knows where the settings live, and is
 * plain text when it does not. The sentence is never assembled from pieces,
 * so word order stays with the catalogue.
 */
export function footerNote(
  rich: RichFn,
  key: string,
  settingsUrl?: null | string,
): ReactNode {
  const url = settingsUrl?.trim();

  return rich(key, {
    settings: (chunks: ReactNode) =>
      url ? <SettingsLink url={url}>{chunks}</SettingsLink> : chunks,
  });
}

/** The "or paste this URL" line, the same in every notification email. */
export function linkInstructions(t: TranslateFn): string {
  return t(`${NOTIFICATION_SHARED_SCOPE}.linkInstructions`);
}
