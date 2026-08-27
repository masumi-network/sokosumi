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
});
