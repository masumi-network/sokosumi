import { describe, expect, it } from "vitest";

import { notificationEventDataSchema } from "./schema";

const EVENT = {
  id: "notification-1",
  userId: "user-1",
  kind: "JOB",
  referenceId: "job-1",
  eventId: "event-1",
  messageKey: "Notifications.Job.completed",
  messageParams: {},
  metadata: null,
  isRead: false,
  readAt: null,
  createdAt: "2026-11-27T12:00:00.000Z",
};

describe("notificationEventDataSchema network", () => {
  it("keeps the Network Core sends", () => {
    expect(
      notificationEventDataSchema.parse({ ...EVENT, network: "preprod" })
        .network,
    ).toBe("preprod");
  });

  it("reads an event from a Core that predates the field as no Network", () => {
    expect(notificationEventDataSchema.parse(EVENT).network).toBeNull();
  });
});
