import { describe, expect, it } from "vitest";

import {
  getNotificationHref,
  VENDOR_GRANT_PENDING_MESSAGE_KEY,
} from "../notification-href.js";

describe("getNotificationHref", () => {
  it("returns job href with agentId", () => {
    expect(
      getNotificationHref({
        kind: "JOB",
        referenceId: "job-1",
        metadata: { agentId: "agent-1" },
      }),
    ).toBe("/agents/agent-1/jobs/job-1");
  });

  it("falls back to /tasks when job metadata lacks agentId", () => {
    expect(
      getNotificationHref({
        kind: "JOB",
        referenceId: "job-1",
        metadata: null,
      }),
    ).toBe("/tasks");
  });

  it("returns task href", () => {
    expect(
      getNotificationHref({
        kind: "TASK",
        referenceId: "task-1",
        metadata: null,
      }),
    ).toBe("/tasks/task-1");
  });

  it("deep-links CHAT notifications to the room", () => {
    expect(
      getNotificationHref({
        kind: "CHAT",
        referenceId: "room-1",
        metadata: { messageId: "msg-1", workspaceId: "ws-1" },
      }),
    ).toBe("/chat/rooms/room-1");
  });

  it("encodes roomId in CHAT deep links", () => {
    expect(
      getNotificationHref({
        kind: "CHAT",
        referenceId: "room/with spaces",
        metadata: null,
      }),
    ).toBe("/chat/rooms/room%2Fwith%20spaces");
  });

  it("deep-links pending vendor grant SYSTEM to personal review", () => {
    expect(
      getNotificationHref({
        kind: "SYSTEM",
        referenceId: "grant-1",
        messageKey: VENDOR_GRANT_PENDING_MESSAGE_KEY,
        metadata: { vendorGrantId: "grant-1" },
      }),
    ).toBe("/account#vendor-workspace-access");
  });

  it("deep-links pending vendor grant SYSTEM to org review", () => {
    expect(
      getNotificationHref({
        kind: "SYSTEM",
        referenceId: "grant-1",
        messageKey: VENDOR_GRANT_PENDING_MESSAGE_KEY,
        metadata: {
          vendorGrantId: "grant-1",
          organizationId: "org_1",
        },
      }),
    ).toBe("/organizations/org_1#vendor-workspace-access");
  });

  it("falls back to home for non-pending SYSTEM notifications", () => {
    expect(
      getNotificationHref({
        kind: "SYSTEM",
        referenceId: "notice-1",
        messageKey: "notifications.system.generic",
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
