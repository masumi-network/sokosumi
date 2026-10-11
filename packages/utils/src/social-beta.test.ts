import { describe, expect, it } from "vitest";

import { SOCIAL_BETA_ORGANIZATION_SLUG } from "./social-beta.js";

describe("SOCIAL_BETA_ORGANIZATION_SLUG", () => {
  it("is the utxo workspace slug web and Core both check", () => {
    expect(SOCIAL_BETA_ORGANIZATION_SLUG).toBe("utxo");
  });
});
