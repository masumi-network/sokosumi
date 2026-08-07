import { describe, expect, it } from "vitest";

import { chatMembershipRevokedEventSchema } from "../chat-membership-revoked-event";

describe("chatMembershipRevokedEventSchema", () => {
  it("accepts a valid revoke payload", () => {
    expect(
      chatMembershipRevokedEventSchema.parse({
        roomId: "room-a",
        reason: "removed",
        at: "2026-08-06T12:00:00.000Z",
      }),
    ).toEqual({
      roomId: "room-a",
      reason: "removed",
      at: "2026-08-06T12:00:00.000Z",
    });
  });

  it("rejects unknown reasons, missing fields, and non-ISO timestamps", () => {
    expect(
      chatMembershipRevokedEventSchema.safeParse({
        roomId: "room-a",
        reason: "kicked",
        at: "2026-08-06T12:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      chatMembershipRevokedEventSchema.safeParse({
        reason: "left",
        at: "2026-08-06T12:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      chatMembershipRevokedEventSchema.safeParse({
        roomId: "room-a",
        reason: "removed",
        at: "not-a-timestamp",
      }).success,
    ).toBe(false);
    expect(
      chatMembershipRevokedEventSchema.safeParse({
        roomId: "room-a",
        reason: "removed",
        at: "2026-08-06",
      }).success,
    ).toBe(false);
  });
});
