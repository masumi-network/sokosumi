import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NotificationRowIcon } from "@/components/notifications/notification-row-icon";
import type { NotificationItem } from "@/lib/clients/generated/core";

function notification(isRead: boolean): NotificationItem {
  return {
    id: "notification-1",
    userId: "user-1",
    kind: "JOB",
    referenceId: "job-1",
    eventId: "event-1",
    messageKey: "Notifications.Job.completed",
    messageParams: {},
    metadata: null,
    isRead,
    readAt: isRead ? new Date("2026-06-18T09:30:00.000Z") : null,
    createdAt: new Date("2026-06-18T09:00:00.000Z"),
  };
}

function renderIcon(isRead: boolean) {
  const { container } = render(
    <NotificationRowIcon notification={notification(isRead)} />,
  );
  const circle = container.querySelector(
    '[data-testid="notification-row-icon"]',
  );

  if (circle === null) {
    throw new Error("the icon rendered nothing");
  }

  return circle;
}

describe("NotificationRowIcon", () => {
  it("tints the circle on an unread row", () => {
    // The tint is one of the two things that carry unread on both surfaces,
    // so a single edit here would take the state off the bell and the page
    // at once.
    const circle = renderIcon(false);

    expect(circle.className).toContain("bg-primary-quaternary");
    expect(circle.className).toContain("text-primary");
  });

  it("recedes on a read row", () => {
    const circle = renderIcon(true);

    expect(circle.className).toContain("bg-quinary");
    expect(circle.className).toContain("text-muted-foreground");
    expect(circle.className).not.toContain("bg-primary-quaternary");
  });

  it("keeps the same geometry in both states", () => {
    // A circle that changed size would move the message sideways when a row
    // is marked read, which is the shift these rows exist to avoid.
    for (const circle of [renderIcon(false), renderIcon(true)]) {
      expect(circle.className).toContain("size-8");
      expect(circle.className).toContain("shrink-0");
    }
  });

  it("says nothing, because the label speaks the state", () => {
    expect(renderIcon(false).getAttribute("aria-hidden")).toBe("true");
  });
});
