import { createEmailTranslator } from "../i18n/translate.js";
import { renderActionEmail } from "../templates/action-email.js";
import type {
  ChatDirectMessageFollowUpEmailProps,
  ChatMentionFollowUpEmailProps,
  JobFollowUpEmailProps,
  RenderedEmail,
  TaskFollowUpEmailProps,
} from "../types.js";

/**
 * The reminder emails (SOK-916).
 *
 * One per family rather than one for all four. A mention, a direct message, a
 * task that stopped for you and a job that stopped for you are four different
 * things to the reader, and a single "you have an unread notification" would
 * say less than the notification it is reminding them about.
 *
 * Each is the same shape underneath: the existing action email, which every
 * other transactional email in this package already uses. The families differ
 * in their words and their button, not in their layout, so none of them brings
 * a template of its own.
 *
 * The words live in the three locale catalogs under `notifications.followUp`.
 * The caller chooses the locale, as with every renderer here. Today Core has
 * nothing better to pass than English, because `User` carries no locale, which
 * is a gap named in the spec rather than one this file can close.
 */

const FOLLOW_UP_SCOPE = "notifications.followUp";

type TranslateFn = ReturnType<typeof createEmailTranslator>["t"];

/**
 * The reader's name, or a greeting that does without one.
 *
 * Two catalog entries rather than one with an empty name, because "Hi ," is
 * worse in every language than "Hi".
 */
function buildGreeting(t: TranslateFn, name: null | string | undefined) {
  const trimmedName = name?.trim();

  if (!trimmedName) {
    return t(`${FOLLOW_UP_SCOPE}.greetingWithoutName`);
  }

  return t(`${FOLLOW_UP_SCOPE}.greeting`, { name: trimmedName });
}

/**
 * A name the email can use, or a translated stand-in.
 *
 * The parameters come from the notification that is being reminded about, and
 * a row can legitimately be missing one. A subject line reading "is still
 * waiting for you" with a hole in it would be worse than one that says
 * "Your task", so the hole is filled rather than left.
 */
function nameOr(
  t: TranslateFn,
  value: null | string | undefined,
  fallbackKey: string,
): string {
  const trimmedValue = value?.trim();

  return trimmedValue ? trimmedValue : t(`${FOLLOW_UP_SCOPE}.${fallbackKey}`);
}

interface FollowUpEmailOptions {
  actionUrl: string;
  family: "directMessage" | "job" | "mention" | "task";
  recipientName?: null | string;
  t: TranslateFn;
  values: Record<string, string>;
}

function renderFollowUpEmail({
  actionUrl,
  family,
  recipientName,
  t,
  values,
}: FollowUpEmailOptions): Promise<RenderedEmail> {
  const scope = `${FOLLOW_UP_SCOPE}.${family}`;

  return renderActionEmail({
    actionLabel: t(`${scope}.button`),
    actionUrl,
    body: t(`${scope}.body`, values),
    footer: t(`${FOLLOW_UP_SCOPE}.footer`),
    greeting: buildGreeting(t, recipientName),
    linkInstructions: t(`${FOLLOW_UP_SCOPE}.linkInstructions`),
    preview: t(`${scope}.preview`, values),
    subject: t(`${scope}.subject`, values),
    title: t(`${scope}.title`),
  });
}

/** A mention in a named room that the reader never opened. */
export function renderChatMentionFollowUpEmail({
  actionUrl,
  authorName,
  locale,
  recipientName,
  roomName,
}: ChatMentionFollowUpEmailProps): Promise<RenderedEmail> {
  const { t } = createEmailTranslator(locale);

  return renderFollowUpEmail({
    actionUrl,
    family: "mention",
    recipientName,
    t,
    values: {
      authorName: nameOr(t, authorName, "fallbackAuthorName"),
      roomName: nameOr(t, roomName, "fallbackRoomName"),
    },
  });
}

/**
 * A direct message the reader never opened.
 *
 * No room name, deliberately. A room of two is named after the other person,
 * who here is the author, so naming it would name them twice. The in-app
 * reminder makes the same choice.
 */
export function renderChatDirectMessageFollowUpEmail({
  actionUrl,
  authorName,
  locale,
  recipientName,
}: ChatDirectMessageFollowUpEmailProps): Promise<RenderedEmail> {
  const { t } = createEmailTranslator(locale);

  return renderFollowUpEmail({
    actionUrl,
    family: "directMessage",
    recipientName,
    t,
    values: { authorName: nameOr(t, authorName, "fallbackAuthorName") },
  });
}

/** A task still waiting on the reader: input, approval, authentication, credits. */
export function renderTaskFollowUpEmail({
  actionUrl,
  locale,
  recipientName,
  taskName,
}: TaskFollowUpEmailProps): Promise<RenderedEmail> {
  const { t } = createEmailTranslator(locale);

  return renderFollowUpEmail({
    actionUrl,
    family: "task",
    recipientName,
    t,
    values: { taskName: nameOr(t, taskName, "fallbackTaskName") },
  });
}

/** A job still waiting on the reader: input, or a payment that failed. */
export function renderJobFollowUpEmail({
  actionUrl,
  jobName,
  locale,
  recipientName,
}: JobFollowUpEmailProps): Promise<RenderedEmail> {
  const { t } = createEmailTranslator(locale);

  return renderFollowUpEmail({
    actionUrl,
    family: "job",
    recipientName,
    t,
    values: { jobName: nameOr(t, jobName, "fallbackJobName") },
  });
}
