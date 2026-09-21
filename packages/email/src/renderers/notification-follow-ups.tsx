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

/** Reminder emails (SOK-916). */
const FOLLOW_UP_SCOPE = "notifications.followUp";

interface FollowUpEmailOptions {
  actionUrl: string;
  facts?: readonly ActionEmailFact[];
  family: "billing" | "directMessage" | "mention" | "task";
  quote?: null | string;
  /** Source-row catalog key; omitted when the catalog has no sentence for it. */
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
    // Preheader uses the family line only when the body does; a reason
    // sentence would contradict it.
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

/** No room name: a DM room is named after the author. */
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
