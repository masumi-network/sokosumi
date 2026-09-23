import type { NotificationKind } from "@sokosumi/database";
import {
  type BillingFollowUpReason,
  renderBillingFollowUpEmail,
  renderChatDirectMessageFollowUpEmail,
  renderChatMentionFollowUpEmail,
  renderTaskFollowUpEmail,
} from "@sokosumi/email";
import {
  BILLING_FOLLOW_UP_MESSAGE_KEY,
  BILLING_PAYMENT_FAILED_MESSAGE_KEY,
  CHAT_DIRECT_MESSAGE_FOLLOW_UP_MESSAGE_KEY,
  CHAT_MENTION_FOLLOW_UP_MESSAGE_KEY,
  TASK_FOLLOW_UP_MESSAGE_KEY,
} from "@sokosumi/utils";

import type { SendEmailInput } from "@/clients/email.client";
import { taskAttentionReasonOf } from "@/helpers/notification-email";
import {
  notificationEmailLink,
  notificationSettingsLink,
  readString,
} from "@/helpers/notification-email-link";

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
  /**
   * How many unread rows the reminder speaks for, counted when it was
   * written.
   *
   * One reminder covers a room for a day, so it can stand for several rows.
   * One of them is quoted; several are counted and none is quoted, because no
   * one of them speaks for the rest (SOK-1142). Absent reads as one.
   */
  unreadCount?: null | number;
}

/** Only a low balance mails: Stripe already wrote when a payment failed. */
const BILLING_REASONS: readonly BillingFollowUpReason[] = ["lowBalance"];

function billingFollowUpReason(
  sourceMessageKey: string,
): BillingFollowUpReason | null {
  const tail = sourceMessageKey.slice(sourceMessageKey.lastIndexOf(".") + 1);

  return BILLING_REASONS.find((reason) => reason === tail) ?? null;
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
  const actionUrl = notificationEmailLink(input);
  const recipientName = input.recipientName;
  const shared = {
    actionUrl,
    locale,
    recipientName,
    settingsUrl: notificationSettingsLink(),
  };

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
            unreadCount: input.unreadCount,
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
          unreadCount: input.unreadCount,
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
          unreadCount: input.unreadCount,
        }),
      );

    case TASK_FOLLOW_UP_MESSAGE_KEY:
      return withRecipient(
        input,
        await renderTaskFollowUpEmail({
          ...shared,
          coworkerName: readString(input.messageParams, "coworkerName"),
          projectName: readString(input.messageParams, "projectName"),
          reason: taskAttentionReasonOf(input.sourceMessageKey),
          taskName: readString(input.messageParams, "taskName"),
        }),
      );

    case BILLING_FOLLOW_UP_MESSAGE_KEY: {
      // Stripe already mailed the failed payment. The in-app reminder still
      // lands; this skip is what keeps a second email out of the inbox.
      if (input.sourceMessageKey === BILLING_PAYMENT_FAILED_MESSAGE_KEY) {
        return null;
      }

      const credits = input.messageParams.credits;

      return withRecipient(
        input,
        await renderBillingFollowUpEmail({
          ...shared,
          credits: typeof credits === "number" ? credits : null,
          reason: billingFollowUpReason(input.sourceMessageKey),
        }),
      );
    }

    default:
      return null;
  }
}

/** One tag for all reminder families, so a reminder send is one thing to look for in Resend. */
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
