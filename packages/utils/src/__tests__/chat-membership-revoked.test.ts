import { describe, expect, it } from "vitest";

import {
  CHAT_MEMBERSHIP_REVOKE_REASONS,
  CHAT_MEMBERSHIP_REVOKED_EVENT_NAME,
} from "../chat-membership-revoked";

describe("chat membership revoked contract", () => {
  it("exports a stable Ably event name", () => {
    expect(CHAT_MEMBERSHIP_REVOKED_EVENT_NAME).toBe("chat_membership_revoked");
  });

  it("lists revoke reasons used by Core and web", () => {
    expect([...CHAT_MEMBERSHIP_REVOKE_REASONS]).toEqual(["removed", "left"]);
  });
});
