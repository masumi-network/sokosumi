import { describe, expect, it } from "vitest";

import {
  betterAuthOrganizationAdditionalFields,
  betterAuthUserAdditionalFields,
} from "./better-auth-client-schema.js";

describe("betterAuthUserAdditionalFields", () => {
  it("rejects client writes to user stripeCustomerId", () => {
    expect(betterAuthUserAdditionalFields.stripeCustomerId).toEqual({
      type: "string",
      required: false,
      defaultValue: null,
      input: false,
    });
  });
});

describe("betterAuthOrganizationAdditionalFields", () => {
  it("rejects client writes to organization stripeCustomerId", () => {
    expect(betterAuthOrganizationAdditionalFields.stripeCustomerId).toEqual({
      type: "string",
      required: false,
      defaultValue: null,
      input: false,
    });
  });

  // ADR-0038's contract step. Declaring a field Better Auth cannot store
  // would break sign-in; forgetting to remove it would keep a dead column's
  // name in every session.
  it("no longer declares the superseded showRoomUnreadCount", () => {
    expect(betterAuthUserAdditionalFields).not.toHaveProperty(
      "showRoomUnreadCount",
    );
    expect(betterAuthUserAdditionalFields).toHaveProperty(
      "hideRoomUnreadCount",
    );
  });
});
