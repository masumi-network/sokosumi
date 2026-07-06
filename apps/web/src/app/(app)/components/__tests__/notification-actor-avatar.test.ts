import { describe, expect, it } from "vitest";

import { getNotificationActor } from "@/app/components/notification-actor-avatar";
import type {
  CoworkerGrant,
  NotificationItem,
} from "@/lib/clients/generated/core";

function buildNotification(
  messageParams: Record<string, unknown>,
): NotificationItem {
  return {
    id: "notification-1",
    userId: "user-1",
    kind: "TASK",
    referenceId: "task-1",
    eventId: "event-1",
    messageKey: "Notifications.Task.commented",
    messageParams,
    metadata: null,
    isRead: false,
    readAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function buildGrant(coworker: CoworkerGrant["coworker"]): CoworkerGrant {
  return {
    id: "grant-1",
    scope: "TASK_READ",
    status: "GRANTED",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    resolvedAt: null,
    coworker,
  };
}

describe("getNotificationActor", () => {
  it("prefers the grant coworker over message params", () => {
    const notification = buildNotification({
      coworkerName: "Someone Else",
      coworkerImage: "https://example.com/other.png",
    });
    const grant = buildGrant({
      id: "coworker-1",
      slug: "hannah",
      name: "Hannah",
      image: "https://example.com/hannah.png",
    });

    const actor = getNotificationActor(notification, grant);

    expect(actor).toEqual({
      name: "Hannah",
      image: "https://example.com/hannah.png",
    });
  });

  it("builds the actor from coworkerName and coworkerImage params", () => {
    const notification = buildNotification({
      coworkerName: "Hannah",
      coworkerImage: "https://x/img.png",
    });

    const actor = getNotificationActor(notification);

    expect(actor).toEqual({ name: "Hannah", image: "https://x/img.png" });
  });

  it("still produces an actor from coworkerName and coworkerSlug alone", () => {
    const notification = buildNotification({
      coworkerName: "Custom Coworker",
      coworkerSlug: "custom-coworker",
    });

    const actor = getNotificationActor(notification);

    expect(actor).not.toBeNull();
    expect(actor?.name).toBe("Custom Coworker");
  });

  it("returns null for a bare coworkerName without image or slug", () => {
    const notification = buildNotification({ coworkerName: "A coworker" });

    expect(getNotificationActor(notification)).toBeNull();
  });

  it("returns null when there is no coworkerName param", () => {
    const notification = buildNotification({
      coworkerImage: "https://x/img.png",
    });

    expect(getNotificationActor(notification)).toBeNull();
  });

  it("ignores non-string param values", () => {
    const notification = buildNotification({
      coworkerName: 42,
      coworkerImage: "https://x/img.png",
    });

    expect(getNotificationActor(notification)).toBeNull();
  });
});
