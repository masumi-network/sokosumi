import { describe, expect, it } from "vitest";

import { getNotificationHref } from "@/lib/utils/notification-href";

describe("getNotificationHref", () => {
  it("links jobs to the agent job detail route when agentId is present", () => {
    expect(
      getNotificationHref({
        kind: "JOB",
        referenceId: "job-1",
        metadata: { agentId: "agent-1" },
      }),
    ).toBe("/agents/agent-1/jobs/job-1");
  });

  it("falls back to tasks when job agentId metadata is missing", () => {
    expect(
      getNotificationHref({
        kind: "JOB",
        referenceId: "job-1",
        metadata: null,
      }),
    ).toBe("/tasks");
  });

  it("links tasks to the task detail route", () => {
    expect(
      getNotificationHref({
        kind: "TASK",
        referenceId: "task-1",
        metadata: null,
      }),
    ).toBe("/tasks/task-1");
  });

  it("deep-links CHAT mention notifications to the room", () => {
    expect(
      getNotificationHref({
        kind: "CHAT",
        referenceId: "room-1",
        metadata: { roomId: "room-1", messageId: "msg-1" },
      }),
    ).toBe("/chat/rooms/room-1");
  });

  it("encodes roomId in CHAT deep links", () => {
    expect(
      getNotificationHref({
        kind: "CHAT",
        referenceId: "room/with spaces",
        metadata: { roomId: "room/with spaces" },
      }),
    ).toBe("/chat/rooms/room%2Fwith%20spaces");
  });

  it("uses referenceId when CHAT metadata.roomId is missing", () => {
    expect(
      getNotificationHref({
        kind: "CHAT",
        referenceId: "room-2",
        metadata: null,
      }),
    ).toBe("/chat/rooms/room-2");
  });

  it("falls back to home for SYSTEM notifications", () => {
    expect(
      getNotificationHref({
        kind: "SYSTEM",
        referenceId: "grant-1",
        metadata: { vendorGrantId: "grant-1", roomId: "should-not-route" },
      }),
    ).toBe("/");
  });

  it("falls back to home for BILLING notifications", () => {
    expect(
      getNotificationHref({
        kind: "BILLING",
        referenceId: "invoice-1",
        metadata: { roomId: "should-not-route" },
      }),
    ).toBe("/");
  });
});
