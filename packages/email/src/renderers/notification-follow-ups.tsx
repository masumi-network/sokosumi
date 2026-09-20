import { createEmailTranslator } from "../i18n/translate.js";
import {
  type ActionEmailFact,
  renderActionEmail,
} from "../templates/action-email.js";
import type {
  ChatDirectMessageFollowUpEmailProps,
  ChatMentionFollowUpEmailProps,
  RenderedEmail,
  TaskFollowUpEmailProps,
} from "../types.js";

const FOLLOW_UP_SCOPE = "notifications.followUp";

type TranslateFn = ReturnType<typeof createEmailTranslator>["t"];

/** Two catalog entries: "Hi ," is worse in every language than "Hi". */
function buildGreeting(t: TranslateFn, name: null | string | undefined) {
  const trimmedName = name?.trim();

  if (!trimmedName) {
    return t(`${FOLLOW_UP_SCOPE}.greetingWithoutName`);
  }

  return t(`${FOLLOW_UP_SCOPE}.greeting`, { name: trimmedName });
}

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
  facts?: readonly ActionEmailFact[];
  family: "directMessage" | "mention" | "task";
  quote?: null | string;
  /** Catalog sentence key from the source row; omitted keys use the family body. */
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
    linkInstructions: t(`${FOLLOW_UP_SCOPE}.linkInstructions`),
    // Reason body and family preheader contradict (assigned vs "stopped and
    // asked for you"), so the preheader follows the body when a reason is set.
    preview: reason ? body : t(`${scope}.preview`, values),
    quote: trimmedQuote ? trimmedQuote : undefined,
    subject: t(`${scope}.subject`, values),
    title: t(`${scope}.title`),
  });
}

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

/** No room name: a room of two is named after the author, so naming it twice. */
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
