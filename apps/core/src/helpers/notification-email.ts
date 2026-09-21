import type { NotificationKind } from "@sokosumi/database";
import {
  renderAccessRequestEmail,
  renderChatDirectMessageEmail,
  renderChatMentionEmail,
  renderProjectUpdateEmail,
  renderTaskAttentionEmail,
  renderTaskCompletedEmail,
  renderTaskUpdateEmail,
  type TaskAttentionReason,
  type TaskUpdateReason,
} from "@sokosumi/email";
import {
  CHAT_DIRECT_MESSAGE_MESSAGE_KEY,
  CHAT_MENTION_MESSAGE_KEY,
  COWORKER_ACCESS_PENDING_MESSAGE_KEY,
  type NotificationCategory,
  VENDOR_GRANT_PENDING_MESSAGE_KEY,
} from "@sokosumi/utils";

import type { SendEmailInput } from "@/clients/email.client";
import { TASK_COMPLETED_MESSAGE_KEY } from "@/helpers/notification-delivery";
import {
  notificationEmailLink,
  readString,
} from "@/helpers/notification-email-link";

/**
 * The email for one notification, the moment it is written (SOK-1090).
 *
 * Built from the row that was just written, so the inbox and the
 * Notification Center say the same thing about the same row. The reminder a
 * day later (`notification-follow-up-email.ts`) is built the same way from
 * the reminder row.
 *
 * The locale is the caller's to pass and today it is always English. `User`
 * carries no locale column; SOK-1096 owns that.
 */

const MINUTE_MS = 60_000;

/**
 * How long an email waits when the reader has the app in front, by category.
 *
 * The email exists for the reader who is away. One who is looking at the app
 * is given that long to get to the notification first, and the email is
 * cancelled when they do. A reader who turned the category off in the app
 * sees no row to get to. For an attention row the wait still pays: a record
 * that settles inside it takes the email back, so nobody is asked about a
 * task that has already ended. A finished task has no such write; only a
 * click takes that email back. Held for less when the message is more
 * likely to be waited on: a direct message is a conversation, a finished
 * task is an outcome that keeps.
 *
 * A category absent from here is never emailed at the event. Follow-ups are
 * emailed by their own sync, and the rest have no email at all
 * (`NOTIFICATION_EMAIL_CATEGORIES`).
 */
const EMAIL_DELAY_MS: Partial<Record<NotificationCategory, number>> = {
  CHAT_DIRECT_MESSAGE: 5 * MINUTE_MS,
  CHAT_MENTION: 10 * MINUTE_MS,
  TASK_ATTENTION: 10 * MINUTE_MS,
  TASK_COMPLETED: 30 * MINUTE_MS,
  TASK_UPDATE: 30 * MINUTE_MS,
  PROJECT_UPDATE: 10 * MINUTE_MS,
  SYSTEM: 5 * MINUTE_MS,
};

/** The delay for a category, or null when the category sends no email at the event. */
export function notificationEmailDelayMs(
  category: NotificationCategory | null,
): null | number {
  return category === null ? null : (EMAIL_DELAY_MS[category] ?? null);
}

/**
 * Why the task is waiting, or null when this key is not an attention key.
 *
 * Read off the end of the message key, because every attention key Core
 * writes ends in the word the catalogs use: `Notifications.Task.inputRequired`
 * and `notifications.event.task.attention.reasons.inputRequired`. A key added
 * to the family later gets no sentence until one is written, rather than
 * asking the catalog for one nobody has.
 */
const TASK_REASONS: readonly TaskAttentionReason[] = [
  "approvalRequired",
  "assigned",
  "authenticationRequired",
  "inputRequired",
  "outOfCredits",
  "scheduleRemovedByOperator",
];

export function taskAttentionReasonOf(
  messageKey: string,
): null | TaskAttentionReason {
  const tail = messageKey.slice(messageKey.lastIndexOf(".") + 1);

  return (
    TASK_REASONS.find(
      (reason): reason is TaskAttentionReason => reason === tail,
    ) ?? null
  );
}

const TASK_UPDATE_REASONS: readonly TaskUpdateReason[] = [
  "failed",
  "canceled",
  "scheduleRepaired",
  "scheduleRemovedByOperator",
  "scheduleUpdatedByMember",
  "scheduleRemovedByMember",
  "scheduleSourceChangedByMember",
  "scheduleOccurrenceChangedByMember",
];

/** What the notification is about, spelled the way the email needs it. */
export interface NotificationEmailInput {
  kind: NotificationKind;
  referenceId: string;
  messageKey: string;
  messageParams: Record<string, unknown>;
  metadata?: Record<string, unknown> | null;
  recipientEmail: string;
  recipientName: null | string;
}

/**
 * The email to send for this notification, or null when it has none.
 *
 * Null for a message key with no email of its own, such as a room message
 * or a chat key nobody mapped. The delay table above already keeps those
 * categories out, so this branch answers for a key inside an emailing category
 * that still has no template, which is the safe way round for a key added
 * later.
 */
export async function buildNotificationEmail(
  input: NotificationEmailInput,
  locale = "en",
): Promise<null | SendEmailInput> {
  const actionUrl = notificationEmailLink(input);
  const shared = { actionUrl, locale, recipientName: input.recipientName };
  const params = input.messageParams;

  switch (input.messageKey) {
    case CHAT_MENTION_MESSAGE_KEY: {
      // A mention in a room of two is stored with `isDirect`, and the room is
      // named after the person who wrote it. Naming the room as well would
      // name them twice, so it takes the direct-message wording instead. Web
      // swaps the same way at render time (`notification-message.ts`).
      const authorName = readString(params, "authorName");
      const messagePreview = readString(params, "messagePreview");

      if (params.isDirect === true) {
        return withRecipient(
          input,
          await renderChatDirectMessageEmail({
            ...shared,
            authorName,
            messagePreview,
          }),
        );
      }

      return withRecipient(
        input,
        await renderChatMentionEmail({
          ...shared,
          authorName,
          messagePreview,
          roomName: readString(params, "roomName"),
        }),
      );
    }

    case CHAT_DIRECT_MESSAGE_MESSAGE_KEY:
      return withRecipient(
        input,
        await renderChatDirectMessageEmail({
          ...shared,
          authorName: readString(params, "authorName"),
          messagePreview: readString(params, "messagePreview"),
        }),
      );

    case TASK_COMPLETED_MESSAGE_KEY:
      return withRecipient(
        input,
        await renderTaskCompletedEmail({
          ...shared,
          coworkerName: readString(params, "coworkerName"),
          projectName: readString(params, "projectName"),
          taskName: readString(params, "taskName"),
        }),
      );

    case "Notifications.Project.closed":
    case "Notifications.Project.closeFailed":
      if (input.kind !== "PROJECT") return null;
      return withRecipient(
        input,
        await renderProjectUpdateEmail({
          ...shared,
          projectName: readString(params, "projectName"),
          outcome:
            input.messageKey === "Notifications.Project.closed"
              ? "closed"
              : "closeFailed",
        }),
      );

    case VENDOR_GRANT_PENDING_MESSAGE_KEY:
      return withRecipient(
        input,
        await renderAccessRequestEmail({
          ...shared,
          request: "vendor",
          requesterName: readString(params, "vendorName"),
        }),
      );

    case COWORKER_ACCESS_PENDING_MESSAGE_KEY:
      return withRecipient(
        input,
        await renderAccessRequestEmail({
          ...shared,
          request: "coworker",
          requesterName: readString(params, "coworkerName"),
        }),
      );

    default: {
      const updateReason =
        input.kind === "TASK"
          ? TASK_UPDATE_REASONS.find(
              (reason) => input.messageKey === `Notifications.Task.${reason}`,
            )
          : undefined;
      if (updateReason) {
        return withRecipient(
          input,
          await renderTaskUpdateEmail({
            ...shared,
            projectName: readString(params, "projectName"),
            reason: updateReason,
            taskName: readString(params, "taskName"),
          }),
        );
      }
      const reason =
        input.kind === "TASK" ? taskAttentionReasonOf(input.messageKey) : null;

      if (reason === null) {
        return null;
      }

      return withRecipient(
        input,
        await renderTaskAttentionEmail({
          ...shared,
          coworkerName: readString(params, "coworkerName"),
          projectName: readString(params, "projectName"),
          reason,
          taskName: readString(params, "taskName"),
        }),
      );
    }
  }
}

/** One tag for all of them, so an event email is one thing to look for in Resend. */
function withRecipient(
  input: NotificationEmailInput,
  rendered: { html: string; subject: string },
): SendEmailInput {
  return {
    to: input.recipientEmail,
    tag: "notification",
    subject: rendered.subject,
    html: rendered.html,
  };
}
