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
  family:
    | "billing"
    | "directMessage"
    | "directMessageMany"
    | "mention"
    | "mentionMany"
    | "task";
  lang: string;
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
  lang,
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
    lang,
    linkInstructions: linkInstructions(t),
    // Preheader uses the family line only when the body does; a reason
    // sentence would contradict it.
    preview: reason ? body : t(`${scope}.preview`, values),
    quote: trimmedQuote ? trimmedQuote : undefined,
    subject: t(`${scope}.subject`, values),
    title: t(`${scope}.title`),
  });
}

/**
 * Whether this reminder stands for more rows than the one it was written
 * from. A tally that is not a whole number above one reads as one.
 */
function standsForSeveral(unreadCount?: null | number): boolean {
  return (
    typeof unreadCount === "number" &&
    Number.isInteger(unreadCount) &&
    unreadCount > 1
  );
}

/**
 * A mention in a named room that the reader never opened.
 *
 * One mention is quoted, the way the event email quoted it. Several are
 * counted and none is quoted, because no one of them speaks for the rest
 * (SOK-1142).
 */
export function renderChatMentionFollowUpEmail({
  actionUrl,
  authorName,
  locale,
  messagePreview,
  recipientName,
  roomName,
  unreadCount,
}: ChatMentionFollowUpEmailProps): Promise<RenderedEmail> {
  const { locale: lang, t } = createEmailTranslator(locale);
  const many = standsForSeveral(unreadCount);
  const room = nameOr(t, roomName, "fallbackRoomName");

  return renderFollowUpEmail({
    lang,
    actionUrl,
    family: many ? "mentionMany" : "mention",
    quote: many ? null : messagePreview,
    recipientName,
    t,
    values: many
      ? { count: String(unreadCount), roomName: room }
      : {
          authorName: nameOr(t, authorName, "fallbackAuthorName"),
          roomName: room,
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
  unreadCount,
}: ChatDirectMessageFollowUpEmailProps): Promise<RenderedEmail> {
  const { locale: lang, t } = createEmailTranslator(locale);
  const many = standsForSeveral(unreadCount);
  const author = nameOr(t, authorName, "fallbackAuthorName");

  return renderFollowUpEmail({
    lang,
    actionUrl,
    family: many ? "directMessageMany" : "directMessage",
    quote: many ? null : messagePreview,
    recipientName,
    t,
    values: many
      ? { authorName: author, count: String(unreadCount) }
      : { authorName: author },
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
  const { locale: lang, t } = createEmailTranslator(locale);
  const hasCredits = typeof credits === "number";

  return renderFollowUpEmail({
    lang,
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
  const { locale: lang, t } = createEmailTranslator(locale);
  const trimmedProjectName = projectName?.trim();

  return renderFollowUpEmail({
    lang,
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
