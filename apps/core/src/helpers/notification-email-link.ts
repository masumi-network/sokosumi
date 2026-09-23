import type { NotificationKind } from "@sokosumi/database";
import {
  COWORKER_ACCESS_PENDING_MESSAGE_KEY,
  VENDOR_GRANT_PENDING_MESSAGE_KEY,
} from "@sokosumi/utils";

import { getWebAppBaseUrl } from "@/config/env";

/** What the link needs to know about the notification it opens. */
export interface NotificationEmailLinkInput {
  kind: NotificationKind;
  referenceId: string;
  messageKey: string;
  metadata?: Record<string, unknown> | null;
}

/**
 * Names the message a chat email is about, on the room's own URL.
 *
 * The same parameter web puts there (`CHAT_MESSAGE_PARAM` in
 * `apps/web/src/lib/utils/notification-href.ts`) and the room client reads.
 * Spelled again here rather than shared, because the web module it lives in
 * pulls in vendor-grant helpers this app has no use for. The two must agree.
 */
const CHAT_MESSAGE_PARAM = "message";

/** Where the footer note sends a reader who wants to change what arrives. */
export function notificationSettingsLink(): string {
  return `${getWebAppBaseUrl()}/account/notifications`;
}

/** One string field of a stored JSON column, or null when it is not one. */
export function readString(
  values: Record<string, unknown> | null | undefined,
  key: string,
): null | string {
  const value = values?.[key];

  return typeof value === "string" ? value : null;
}

/**
 * Where an email about this notification opens, absolute so it works from an
 * inbox.
 *
 * Deliberately the same destinations web sends a clicked notification to
 * (`getNotificationHref`), so the email and the Notification Center land in
 * the same place. Web is the owner of that routing; this repeats only the
 * kinds an email is sent for, and a kind with nothing of its own to open
 * lands on the home page as it does there.
 *
 * One destination differs today, and the email has the right one. Web sends a
 * clicked vendor-grant row to the organization by id, and that page resolves
 * by slug and answers an id with a 404. The fix belongs to web's resolver,
 * which reads the id from metadata that now carries the slug beside it.
 */
export function notificationEmailLink(
  input: NotificationEmailLinkInput,
): string {
  const base = getWebAppBaseUrl();
  const reference = encodeURIComponent(input.referenceId);

  switch (input.kind) {
    case "TASK":
      return `${base}/tasks/${reference}`;

    case "PROJECT":
      return `${base}/projects/${reference}`;

    case "CHAT": {
      const room = `${base}/chat/rooms/${reference}`;
      const messageId = readString(input.metadata, "messageId")?.trim();

      if (!messageId) {
        return room;
      }

      return `${room}?${CHAT_MESSAGE_PARAM}=${encodeURIComponent(messageId)}`;
    }

    case "SYSTEM":
      return accessRequestLink(base, input);

    case "BILLING":
      return `${base}/billing?tab=credits`;

    default:
      return `${base}/`;
  }
}

/**
 * Where a workspace access request is reviewed.
 *
 * A request for a personal workspace carries no organization and is reviewed
 * on the account page. An organization is addressed by its slug and by
 * nothing else, because the review page resolves by slug: the id reaches the
 * same route and is answered with a 404. Both producers write the slug onto
 * the row, so its absence is what says the workspace is personal.
 */
function accessRequestLink(
  base: string,
  input: NotificationEmailLinkInput,
): string {
  const section =
    input.messageKey === VENDOR_GRANT_PENDING_MESSAGE_KEY
      ? "vendor-workspace-access"
      : input.messageKey === COWORKER_ACCESS_PENDING_MESSAGE_KEY
        ? "coworker-early-access"
        : null;

  if (section === null) {
    return `${base}/`;
  }

  const organizationSlug = readString(input.metadata, "organizationSlug");

  if (organizationSlug === null) {
    return `${base}/account#${section}`;
  }

  return `${base}/organizations/${encodeURIComponent(organizationSlug)}#${section}`;
}
