import { createEmailTranslator } from "../i18n/translate.js";
import {
  type ActionEmailFact,
  renderActionEmail,
} from "../templates/action-email.js";
import type {
  AccessRequestEmailProps,
  ChatDirectMessageEmailProps,
  ChatMentionEmailProps,
  RenderedEmail,
  TaskAttentionEmailProps,
  TaskCompletedEmailProps,
} from "../types.js";
import {
  buildGreeting,
  linkInstructions,
  nameOr,
  type TranslateFn,
} from "./notification-shared.js";

/**
 * The notification emails (SOK-1090).
 *
 * One per thing the reader is told about: a mention, a direct message, a task
 * that stopped for them, a task that finished, and someone asking for access
 * to a workspace they manage. Each says what the in-app notification says and
 * opens where it opens, so the inbox and the Notification Center never
 * disagree about the same row.
 *
 * All five are the action email every other transactional email here uses.
 * They differ in their words and their button, not in their layout. The words
 * live under `notifications.event` in the three catalogs; the reminders a day
 * later (SOK-916) live beside them under `notifications.followUp`.
 *
 * The caller chooses the locale. Today Core passes English, because `User`
 * carries no locale column (SOK-1096).
 */

const EVENT_SCOPE = "notifications.event";

interface EventEmailOptions {
  actionUrl: string;
  facts?: readonly ActionEmailFact[];
  quote?: null | string;
  recipientName?: null | string;
  t: TranslateFn;
  /** The catalog entry for the words: subject, body and button. */
  words: {
    body: string;
    button: string;
    subject: string;
    title: string;
  };
}

function renderEventEmail({
  actionUrl,
  facts,
  quote,
  recipientName,
  t,
  words,
}: EventEmailOptions): Promise<RenderedEmail> {
  const trimmedQuote = quote?.trim();

  return renderActionEmail({
    actionLabel: words.button,
    actionUrl,
    body: words.body,
    facts,
    footer: t(`${EVENT_SCOPE}.footer`),
    greeting: buildGreeting(t, recipientName),
    linkInstructions: linkInstructions(t),
    // The preheader is the body. A fresh notification has one sentence to
    // say, and a second line saying it differently would only compete with
    // the first in the inbox list.
    preview: words.body,
    quote: trimmedQuote ? trimmedQuote : undefined,
    subject: words.subject,
    title: words.title,
  });
}

/** Someone wrote the reader's name in a named room. */
export function renderChatMentionEmail({
  actionUrl,
  authorName,
  locale,
  messagePreview,
  recipientName,
  roomName,
}: ChatMentionEmailProps): Promise<RenderedEmail> {
  const { t } = createEmailTranslator(locale);
  const scope = `${EVENT_SCOPE}.mention`;
  const values = {
    authorName: nameOr(t, authorName, "fallbackAuthorName"),
    roomName: nameOr(t, roomName, "fallbackRoomName"),
  };

  return renderEventEmail({
    actionUrl,
    quote: messagePreview,
    recipientName,
    t,
    words: {
      body: t(`${scope}.body`, values),
      button: t(`${scope}.button`),
      subject: t(`${scope}.subject`, values),
      title: t(`${scope}.title`),
    },
  });
}

/**
 * Someone messaged the reader one to one.
 *
 * No room name, deliberately. A room of two is named after the other person,
 * who here is the author, so naming it would name them twice. The in-app
 * notification makes the same choice.
 */
export function renderChatDirectMessageEmail({
  actionUrl,
  authorName,
  locale,
  messagePreview,
  recipientName,
}: ChatDirectMessageEmailProps): Promise<RenderedEmail> {
  const { t } = createEmailTranslator(locale);
  const scope = `${EVENT_SCOPE}.directMessage`;
  const values = { authorName: nameOr(t, authorName, "fallbackAuthorName") };

  return renderEventEmail({
    actionUrl,
    quote: messagePreview,
    recipientName,
    t,
    words: {
      body: t(`${scope}.body`, values),
      button: t(`${scope}.button`),
      subject: t(`${scope}.subject`, values),
      title: t(`${scope}.title`),
    },
  });
}

/** The project a task belongs to, when the notification named one. */
function projectFact(
  t: TranslateFn,
  projectName: null | string | undefined,
): readonly ActionEmailFact[] | undefined {
  const trimmedProjectName = projectName?.trim();

  return trimmedProjectName
    ? [
        {
          label: t(`${EVENT_SCOPE}.task.projectLabel`),
          value: trimmedProjectName,
        },
      ]
    : undefined;
}

/**
 * A task stopped and needs the reader: input, approval, a sign-in, credits,
 * an assignment, or a schedule an operator removed.
 *
 * The reason picks the subject and the body, because "a task needs you" says
 * nothing about which of the six it is, and the reader decides from the
 * subject line whether to open it now.
 */
export function renderTaskAttentionEmail({
  actionUrl,
  coworkerName,
  locale,
  projectName,
  reason,
  recipientName,
  taskName,
}: TaskAttentionEmailProps): Promise<RenderedEmail> {
  const { t } = createEmailTranslator(locale);
  const scope = `${EVENT_SCOPE}.task.attention`;
  const values = {
    coworkerName: nameOr(t, coworkerName, "fallbackCoworkerName"),
    taskName: nameOr(t, taskName, "fallbackTaskName"),
  };

  return renderEventEmail({
    actionUrl,
    facts: projectFact(t, projectName),
    recipientName,
    t,
    words: {
      body: t(`${scope}.reasons.${reason}.body`, values),
      button: t(`${EVENT_SCOPE}.task.button`),
      subject: t(`${scope}.reasons.${reason}.subject`, values),
      title: t(`${scope}.title`),
    },
  });
}

/** A task finished the work the reader asked for. */
export function renderTaskCompletedEmail({
  actionUrl,
  coworkerName,
  locale,
  projectName,
  recipientName,
  taskName,
}: TaskCompletedEmailProps): Promise<RenderedEmail> {
  const { t } = createEmailTranslator(locale);
  const scope = `${EVENT_SCOPE}.task.completed`;
  const values = {
    coworkerName: nameOr(t, coworkerName, "fallbackCoworkerName"),
    taskName: nameOr(t, taskName, "fallbackTaskName"),
  };

  return renderEventEmail({
    actionUrl,
    facts: projectFact(t, projectName),
    recipientName,
    t,
    words: {
      body: t(`${scope}.body`, values),
      button: t(`${EVENT_SCOPE}.task.button`),
      subject: t(`${scope}.subject`, values),
      title: t(`${scope}.title`),
    },
  });
}

/** A vendor or a coworker asked for a workspace the reader manages. */
export function renderAccessRequestEmail({
  actionUrl,
  locale,
  recipientName,
  request,
  requesterName,
}: AccessRequestEmailProps): Promise<RenderedEmail> {
  const { t } = createEmailTranslator(locale);
  const scope = `${EVENT_SCOPE}.accessRequest`;
  const values = {
    requesterName: nameOr(t, requesterName, "fallbackAuthorName"),
  };

  return renderEventEmail({
    actionUrl,
    recipientName,
    t,
    words: {
      body: t(`${scope}.${request}.body`, values),
      button: t(`${scope}.button`),
      subject: t(`${scope}.${request}.subject`, values),
      title: t(`${scope}.title`),
    },
  });
}
