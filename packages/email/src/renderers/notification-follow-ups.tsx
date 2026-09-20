import { createEmailTranslator } from "../i18n/translate.js";
import {
  type ActionEmailFact,
  renderActionEmail,
} from "../templates/action-email.js";
import type {
  BillingFollowUpEmailProps,
  ChatDirectMessageFollowUpEmailProps,
  ChatMentionFollowUpEmailProps,
  RenderedEmail,
  TaskFollowUpEmailProps,
} from "../types.js";
import {
  buildGreeting,
  linkInstructions,
  nameOr,
  type TranslateFn,
} from "./notification-shared.js";

/**
 * The reminder emails (SOK-916).
 *
 * One per family rather than one for all three. A mention, a direct message
 * and a task that stopped for you are three different things to the reader,
 * and a single "you have an unread notification" would say less than the
 * notification it is reminding them about.
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

interface FollowUpEmailOptions {
  actionUrl: string;
  facts?: readonly ActionEmailFact[];
  family: "billing" | "directMessage" | "mention" | "task";
  quote?: null | string;
  /**
   * Why the thing is waiting, named by the notification that started it.
   *
   * A task stops for six different reasons, and "it needs you" says none of
   * them. The reminder is stored under one message key per family so that a
   * task asking twice in a day is still one reminder, so the reason comes from
   * the source row rather than from the reminder.
   *
   * Absent when the source key is one this catalog has no sentence for, which
   * leaves the family's own body. A union rather than a string, so a key with
   * no sentence cannot reach the catalog and fail to resolve.
   */
  reason?: null | string;
  recipientName?: null | string;
  t: TranslateFn;
  values: Record<string, string>;
}

function renderFollowUpEmail({
  actionUrl,
  facts,
  family,
  quote,
  reason,
  recipientName,
  t,
  values,
}: FollowUpEmailOptions): Promise<RenderedEmail> {
  const scope = `${FOLLOW_UP_SCOPE}.${family}`;
  const trimmedQuote = quote?.trim();
  const body = reason
    ? t(`${scope}.reasons.${reason}`, values)
    : t(`${scope}.body`, values);

  return renderActionEmail({
    actionLabel: t(`${scope}.button`),
    actionUrl,
    body,
    facts,
    footer: t(`${FOLLOW_UP_SCOPE}.footer`),
    greeting: buildGreeting(t, recipientName),
    linkInstructions: linkInstructions(t),
    // The preheader is the family's own line only when the body is too. A
    // reason sentence says the task was assigned, or that a payment failed,
    // and the family preheader says the opposite ("stopped and asked for
    // you"), so the two lines would contradict each other inside one email.
    preview: reason ? body : t(`${scope}.preview`, values),
    quote: trimmedQuote ? trimmedQuote : undefined,
    subject: t(`${scope}.subject`, values),
    title: t(`${scope}.title`),
  });
}

/** A mention in a named room that the reader never opened. */
export function renderChatMentionFollowUpEmail({
  actionUrl,
  authorName,
  locale,
  messagePreview,
  recipientName,
  roomName,
}: ChatMentionFollowUpEmailProps): Promise<RenderedEmail> {
  const { t } = createEmailTranslator(locale);

  return renderFollowUpEmail({
    actionUrl,
    family: "mention",
    quote: messagePreview,
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
  messagePreview,
  recipientName,
}: ChatDirectMessageFollowUpEmailProps): Promise<RenderedEmail> {
  const { t } = createEmailTranslator(locale);

  return renderFollowUpEmail({
    actionUrl,
    family: "directMessage",
    quote: messagePreview,
    recipientName,
    t,
    values: { authorName: nameOr(t, authorName, "fallbackAuthorName") },
  });
}

/** The low-balance sentence names what was left, so it needs the number. */
export function renderBillingFollowUpEmail({
  actionUrl,
  credits,
  locale,
  reason,
  recipientName,
}: BillingFollowUpEmailProps): Promise<RenderedEmail> {
  const { t } = createEmailTranslator(locale);
  const hasCredits = typeof credits === "number";

  return renderFollowUpEmail({
    actionUrl,
    family: "billing",
    reason: reason === "lowBalance" && !hasCredits ? null : reason,
    recipientName,
    t,
    values: hasCredits ? { credits: String(credits) } : {},
  });
}

/** A task still waiting on the reader: input, approval, authentication, credits. */
export function renderTaskFollowUpEmail({
  actionUrl,
  coworkerName,
  locale,
  projectName,
  reason,
  recipientName,
  taskName,
}: TaskFollowUpEmailProps): Promise<RenderedEmail> {
  const { t } = createEmailTranslator(locale);
  const trimmedProjectName = projectName?.trim();

  return renderFollowUpEmail({
    actionUrl,
    facts: trimmedProjectName
      ? [
          {
            label: t(`${FOLLOW_UP_SCOPE}.task.projectLabel`),
            value: trimmedProjectName,
          },
        ]
      : undefined,
    family: "task",
    reason,
    recipientName,
    t,
    values: {
      coworkerName: nameOr(t, coworkerName, "fallbackCoworkerName"),
      taskName: nameOr(t, taskName, "fallbackTaskName"),
    },
  });
}
