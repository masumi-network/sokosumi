import {
  AtSign,
  Bell,
  CircleAlert,
  CircleCheck,
  CreditCard,
  MessageCircle,
  TriangleAlert,
} from "lucide-react";
import { describe, expect, it } from "vitest";

import { getNotificationIcon } from "@/lib/utils/notification-icon";

describe("getNotificationIcon", () => {
  it.each([
    ["CHAT", "Notifications.Chat.mentioned", AtSign],
    ["CHAT", "Notifications.Chat.roomMessage", MessageCircle],
    ["CHAT", "Notifications.Chat.directMessage", MessageCircle],
    ["BILLING", "Notifications.Billing.lowBalance", CreditCard],
    ["JOB", "Notifications.Job.completed", CircleCheck],
    ["JOB", "Notifications.Job.failed", TriangleAlert],
    ["JOB", "Notifications.Job.paymentFailed", TriangleAlert],
    ["TASK", "Notifications.Task.outOfCredits", TriangleAlert],
    ["TASK", "Notifications.Task.canceled", TriangleAlert],
    ["TASK", "Notifications.Task.inputRequired", CircleAlert],
    ["TASK", "Notifications.Task.approvalRequired", CircleAlert],
    ["TASK", "Notifications.Task.assigned", Bell],
    ["SYSTEM", "notifications.vendorGrant.pending", Bell],
  ] as const)("%s %s", (kind, messageKey, expected) => {
    expect(getNotificationIcon({ kind, messageKey })).toBe(expected);
  });
});
