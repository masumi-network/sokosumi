import type { NotificationKind } from "@sokosumi/database";
import {
  renderChatDirectMessageFollowUpEmail,
  renderChatMentionFollowUpEmail,
  renderTaskFollowUpEmail,
  type TaskFollowUpReason,
} from "@sokosumi/email";
import {
  CHAT_DIRECT_MESSAGE_FOLLOW_UP_MESSAGE_KEY,
  CHAT_MENTION_FOLLOW_UP_MESSAGE_KEY,
  TASK_FOLLOW_UP_MESSAGE_KEY,
} from "@sokosumi/utils";

import type { SendEmailInput } from "@/clients/email.client";
import { getWebAppBaseUrl } from "@/config/env";

/**
 * The reminder email for one follow-up (SOK-916).
 *
 * Built from the follow-up that was just written, so the inbox and the
 * Notification Center say the same thing about the same row. It is built after
 * the write and only when the write created something, which is what makes one
 * email per reminder true: the uniqueness the notification table enforces is
 * already what stops the second reminder, so it stops the second email too
 * without a second mechanism.
 *
 * The locale is the caller's to pass and today it is always English. `User`
 * carries no locale column, and the two product emails that already exist pass
 * `"en"` for the same reason. Story 28 asks for better and this file cannot
 * give it alone.
 */

/** What the notification is about, spelled the way the reminder email needs it. */
export interface FollowUpEmailInput {
  kind: NotificationKind;
  referenceId: string;
  messageKey: string;
  /**
   * The key of the notification this is a reminder about.
   *
   * The reminder itself is stored under one key per family, so that a task
   * asking for input and then for approval on one day is one reminder rather
   * than two. That is what the reader wants and it costs the reason, which
   * this carries back: the email can say what the task stopped for while the
   * row stays one row.
   */
  sourceMessageKey: string;
  messageParams: Record<string, unknown>;
  metadata?: Record<string, unknown> | null;
  recipientEmail: string;
  recipientName: null | string;
}

/**
 * Why the task is waiting, or null when this key has no sentence.
 *
 * Read off the end of the message key, because every attention key Core writes
 * ends in the word the catalogs use: `Notifications.Task.inputRequired` and
 * `notifications.followUp.task.reasons.inputRequired`. A key added to a family
 * later falls through to the family's own body rather than asking the catalog
 * for a sentence nobody has written.
 */
const TASK_REASONS: readonly TaskFollowUpReason[] = [
  "approvalRequired",
  "assigned",
  "authenticationRequired",
  "inputRequired",
  "outOfCredits",
  "scheduleRemovedByOperator",
];

function reasonIn<T extends string>(
  reasons: readonly T[],
  sourceMessageKey: string,
): null | T {
  const tail = sourceMessageKey.slice(sourceMessageKey.lastIndexOf(".") + 1);

  return reasons.find((reason): reason is T => reason === tail) ?? null;
}

/**
 * Names the message a chat reminder is about, on the room's own URL.
 *
 * The same parameter web puts there (`CHAT_MESSAGE_PARAM` in
 * `apps/web/src/lib/utils/notification-href.ts`) and the room client reads.
 * Spelled again here rather than shared, because the web module it lives in
 * pulls in vendor-grant helpers this app has no use for. The two must agree;
 * only these three kinds are repeated, and the SYSTEM routing is not.
 */
const CHAT_MESSAGE_PARAM = "message";

function readString(
  values: Record<string, unknown> | null | undefined,
  key: string,
): null | string {
  const value = values?.[key];

  return typeof value === "string" ? value : null;
}

/**
 * Where the reminder opens, absolute so it works from an inbox.
 *
 * Deliberately the same destinations web sends a clicked notification to, so
 * the email and the Notification Center land in the same place.
 */
function followUpLink(input: FollowUpEmailInput): string {
  const base = getWebAppBaseUrl();
  const reference = encodeURIComponent(input.referenceId);

  switch (input.kind) {
    case "TASK":
      return `${base}/tasks/${reference}`;

    default: {
      const room = `${base}/chat/rooms/${reference}`;
      const messageId = readString(input.metadata, "messageId")?.trim();

      if (!messageId) {
        return room;
      }

      return `${room}?${CHAT_MESSAGE_PARAM}=${encodeURIComponent(messageId)}`;
    }
  }
}

/**
 * The email to send for this reminder, or null when there is none to send.
 *
 * Null for a message key with no email of its own. The caller only ever passes
 * a key it has just written a follow-up under, so that branch answers for the
 * type rather than for anything the sync produces.
 */
export async function buildFollowUpEmail(
  input: FollowUpEmailInput,
  locale = "en",
): Promise<null | SendEmailInput> {
  const actionUrl = followUpLink(input);
  const recipientName = input.recipientName;
  const shared = { actionUrl, locale, recipientName };

  switch (input.messageKey) {
    case CHAT_MENTION_FOLLOW_UP_MESSAGE_KEY: {
      // A mention in a room of two is stored with `isDirect`, and the room is
      // named after the person who wrote it. Naming the room as well would
      // name them twice, so it takes the direct-message wording instead. Web
      // swaps the same way at render time (`notification-message.ts`).
      const authorName = readString(input.messageParams, "authorName");

      const messagePreview = readString(input.messageParams, "messagePreview");

      if (input.messageParams.isDirect === true) {
        return withRecipient(
          input,
          await renderChatDirectMessageFollowUpEmail({
            ...shared,
            authorName,
            messagePreview,
          }),
        );
      }

      return withRecipient(
        input,
        await renderChatMentionFollowUpEmail({
          ...shared,
          authorName,
          messagePreview,
          roomName: readString(input.messageParams, "roomName"),
        }),
      );
    }

    case CHAT_DIRECT_MESSAGE_FOLLOW_UP_MESSAGE_KEY:
      return withRecipient(
        input,
        await renderChatDirectMessageFollowUpEmail({
          ...shared,
          authorName: readString(input.messageParams, "authorName"),
          messagePreview: readString(input.messageParams, "messagePreview"),
        }),
      );

    case TASK_FOLLOW_UP_MESSAGE_KEY:
      return withRecipient(
        input,
        await renderTaskFollowUpEmail({
          ...shared,
          coworkerName: readString(input.messageParams, "coworkerName"),
          projectName: readString(input.messageParams, "projectName"),
          reason: reasonIn(TASK_REASONS, input.sourceMessageKey),
          taskName: readString(input.messageParams, "taskName"),
        }),
      );

    default:
      return null;
  }
}

/** One tag for all three, so a reminder send is one thing to look for in Resend. */
function withRecipient(
  input: FollowUpEmailInput,
  rendered: { html: string; subject: string },
): SendEmailInput {
  return {
    to: input.recipientEmail,
    tag: "notification-follow-up",
    subject: rendered.subject,
    html: rendered.html,
  };
}
