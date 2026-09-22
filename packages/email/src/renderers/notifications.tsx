import { createEmailTranslator } from "../i18n/translate.js";
import {
  type ActionEmailFact,
  renderActionEmail,
} from "../templates/action-email.js";
import type {
  AccessRequestEmailProps,
  ChatDirectMessageEmailProps,
  ChatMentionEmailProps,
  ChatRoomMessageEmailProps,
  ProjectUpdateEmailProps,
  RenderedEmail,
  TaskAttentionEmailProps,
  TaskCompletedEmailProps,
  TaskUpdateEmailProps,
} from "../types.js";
import {
  buildGreeting,
  footerNote,
  linkInstructions,
  nameOr,
  type RichFn,
  type TranslateFn,
} from "./notification-shared.js";

/** Notification emails (SOK-1090). */
const EVENT_SCOPE = "notifications.event";

interface EventEmailOptions {
  rich: RichFn;
  actionUrl: string;
  settingsUrl?: null | string;
  facts?: readonly ActionEmailFact[];
  lang: string;
  quote?: null | string;
  recipientName?: null | string;
  t: TranslateFn;
  words: {
    body: string;
    button: string;
    subject: string;
    title: string;
  };
}

function renderEventEmail({
  actionUrl,
  rich,
  settingsUrl,
  facts,
  lang,
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
    footer: footerNote(rich, `${EVENT_SCOPE}.footer`, settingsUrl),
    greeting: buildGreeting(t, recipientName),
    lang,
    linkInstructions: linkInstructions(t),
    // Preheader is the body so the inbox list does not get a competing
    // second line.
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
  settingsUrl,
  roomName,
}: ChatMentionEmailProps): Promise<RenderedEmail> {
  const { locale: lang, rich, t } = createEmailTranslator(locale);
  const scope = `${EVENT_SCOPE}.mention`;
  const values = {
    authorName: nameOr(t, authorName, "fallbackAuthorName"),
    roomName: nameOr(t, roomName, "fallbackRoomName"),
  };

  return renderEventEmail({
    lang,
    rich,
    settingsUrl,
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

/** No room name: a DM room is named after the author. */
export function renderChatDirectMessageEmail({
  actionUrl,
  authorName,
  locale,
  messagePreview,
  recipientName,
  settingsUrl,
}: ChatDirectMessageEmailProps): Promise<RenderedEmail> {
  const { locale: lang, rich, t } = createEmailTranslator(locale);
  const scope = `${EVENT_SCOPE}.directMessage`;
  const values = { authorName: nameOr(t, authorName, "fallbackAuthorName") };

  return renderEventEmail({
    lang,
    rich,
    settingsUrl,
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
 * One unread message, or a count of them.
 *
 * A single message is the whole of what is waiting, so the email shows it:
 * who wrote and what they wrote, the way a mention does. Two or more have no
 * one message that speaks for the rest, so the email counts them and quotes
 * nobody. A count that is missing reads as one, because the row an email is
 * built from stands for one message until a second joins it.
 */
export function renderChatRoomMessageEmail({
  actionUrl,
  authorName,
  locale,
  messagePreview,
  recipientName,
  roomName,
  unreadCount,
}: ChatRoomMessageEmailProps): Promise<RenderedEmail> {
  const { t } = createEmailTranslator(locale);
  const scope = `${EVENT_SCOPE}.roomMessage`;
  const room = nameOr(t, roomName, "fallbackRoomName");
  const many = typeof unreadCount === "number" && unreadCount > 1;
  const variant = many ? `${scope}.many` : `${scope}.one`;
  const values: Record<string, string> = many
    ? { count: String(unreadCount), roomName: room }
    : {
        authorName: nameOr(t, authorName, "fallbackAuthorName"),
        roomName: room,
      };

  return renderEventEmail({
    actionUrl,
    quote: many ? null : messagePreview,
    recipientName,
    t,
    words: {
      body: t(`${variant}.body`, values),
      button: t(`${scope}.button`),
      subject: t(`${variant}.subject`, values),
      title: t(`${variant}.title`),
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

/** Reason picks subject and body so the subject names which of the six it is. */
export function renderTaskAttentionEmail({
  actionUrl,
  coworkerName,
  locale,
  projectName,
  reason,
  recipientName,
  settingsUrl,
  taskName,
}: TaskAttentionEmailProps): Promise<RenderedEmail> {
  const { locale: lang, rich, t } = createEmailTranslator(locale);
  const scope = `${EVENT_SCOPE}.task.attention`;
  const values = {
    coworkerName: nameOr(t, coworkerName, "fallbackCoworkerName"),
    taskName: nameOr(t, taskName, "fallbackTaskName"),
  };

  return renderEventEmail({
    lang,
    rich,
    settingsUrl,
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
  settingsUrl,
  taskName,
}: TaskCompletedEmailProps): Promise<RenderedEmail> {
  const { locale: lang, rich, t } = createEmailTranslator(locale);
  const scope = `${EVENT_SCOPE}.task.completed`;
  const values = {
    coworkerName: nameOr(t, coworkerName, "fallbackCoworkerName"),
    taskName: nameOr(t, taskName, "fallbackTaskName"),
  };

  return renderEventEmail({
    lang,
    rich,
    settingsUrl,
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

/**
 * Schedule changes and other task outcomes, using the existing task
 * destination. Reason picks the sentence; `updated` is the fallback for a key
 * nobody has written one for.
 */
export function renderTaskUpdateEmail({
  actionUrl,
  locale,
  projectName,
  reason,
  recipientName,
  taskName,
}: TaskUpdateEmailProps): Promise<RenderedEmail> {
  const { t } = createEmailTranslator(locale);
  const scope = `${EVENT_SCOPE}.task.update`;
  const values = { taskName: nameOr(t, taskName, "fallbackTaskName") };

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

/** A vendor or a coworker asked for a workspace the reader manages. */
export function renderAccessRequestEmail({
  actionUrl,
  locale,
  recipientName,
  settingsUrl,
  request,
  requesterName,
}: AccessRequestEmailProps): Promise<RenderedEmail> {
  const { locale: lang, rich, t } = createEmailTranslator(locale);
  const scope = `${EVENT_SCOPE}.accessRequest`;
  const values = {
    requesterName: nameOr(t, requesterName, "fallbackAuthorName"),
  };

  return renderEventEmail({
    lang,
    rich,
    settingsUrl,
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

/** The terminal outcome of the project close requested by the reader. */
export function renderProjectUpdateEmail({
  actionUrl,
  locale,
  outcome,
  projectName,
  recipientName,
}: ProjectUpdateEmailProps): Promise<RenderedEmail> {
  const { t } = createEmailTranslator(locale);
  const scope = `${EVENT_SCOPE}.project`;
  const values = { projectName: nameOr(t, projectName, "fallbackProjectName") };
  return renderEventEmail({
    actionUrl,
    recipientName,
    t,
    words: {
      body: t(`${scope}.${outcome}.body`, values),
      button: t(`${scope}.button`),
      subject: t(`${scope}.${outcome}.subject`, values),
      title: t(`${scope}.${outcome}.title`),
    },
  });
}
