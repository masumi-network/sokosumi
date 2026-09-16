import type { NotificationKind } from "@sokosumi/database";
import {
  renderChatDirectMessageFollowUpEmail,
  renderChatMentionFollowUpEmail,
  renderJobFollowUpEmail,
  renderTaskFollowUpEmail,
} from "@sokosumi/email";
import {
  CHAT_DIRECT_MESSAGE_FOLLOW_UP_MESSAGE_KEY,
  CHAT_MENTION_FOLLOW_UP_MESSAGE_KEY,
  JOB_FOLLOW_UP_MESSAGE_KEY,
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
  messageParams: Record<string, unknown>;
  metadata?: Record<string, unknown> | null;
  recipientEmail: string;
  recipientName: null | string;
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
 * the email and the Notification Center land in the same place. That includes
 * the job fallback: a job whose row carries no agent id has no job URL to
 * build, and web sends the reader to the task list rather than nowhere, so
 * this does too.
 */
function followUpLink(input: FollowUpEmailInput): string {
  const base = getWebAppBaseUrl();
  const reference = encodeURIComponent(input.referenceId);

  switch (input.kind) {
    case "TASK":
      return `${base}/tasks/${reference}`;

    case "JOB": {
      const agentId = readString(input.metadata, "agentId");

      if (!agentId) {
        return `${base}/tasks`;
      }

      return `${base}/agents/${encodeURIComponent(agentId)}/jobs/${reference}`;
    }

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

      if (input.messageParams.isDirect === true) {
        return withRecipient(
          input,
          await renderChatDirectMessageFollowUpEmail({
            ...shared,
            authorName,
          }),
        );
      }

      return withRecipient(
        input,
        await renderChatMentionFollowUpEmail({
          ...shared,
          authorName,
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
        }),
      );

    case TASK_FOLLOW_UP_MESSAGE_KEY:
      return withRecipient(
        input,
        await renderTaskFollowUpEmail({
          ...shared,
          taskName: readString(input.messageParams, "taskName"),
        }),
      );

    case JOB_FOLLOW_UP_MESSAGE_KEY:
      return withRecipient(
        input,
        await renderJobFollowUpEmail({
          ...shared,
          jobName: readString(input.messageParams, "jobName"),
        }),
      );

    default:
      return null;
  }
}

/** One tag for all four, so a reminder send is one thing to look for in Resend. */
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
