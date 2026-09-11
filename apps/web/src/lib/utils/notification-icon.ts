import { CHAT_MENTION_MESSAGE_KEY } from "@sokosumi/utils";
import {
  AtSign,
  Bell,
  CircleAlert,
  CircleCheck,
  CreditCard,
  type LucideIcon,
  MessageCircle,
  TriangleAlert,
} from "lucide-react";

import type { NotificationItem } from "@/lib/clients/generated/core";

const FAILURE_SUFFIXES = ["failed", "Failed", "outOfCredits", "canceled"];

/**
 * The icon a notification row leads with, so a list of rows reads by kind
 * before it reads by text: a mention, a message, a finished job, a failure.
 */
export function getNotificationIcon(
  notification: Pick<NotificationItem, "kind" | "messageKey">,
): LucideIcon {
  const { kind, messageKey } = notification;

  if (kind === "CHAT") {
    return messageKey === CHAT_MENTION_MESSAGE_KEY ? AtSign : MessageCircle;
  }

  if (kind === "BILLING") {
    return CreditCard;
  }

  if (kind === "JOB" || kind === "TASK") {
    if (FAILURE_SUFFIXES.some((suffix) => messageKey.endsWith(suffix))) {
      return TriangleAlert;
    }
    if (messageKey.endsWith("Required")) {
      return CircleAlert;
    }
    if (messageKey.endsWith("completed")) {
      return CircleCheck;
    }
  }

  return Bell;
}
