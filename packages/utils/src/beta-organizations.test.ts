import { describe, expect, it } from "vitest";

import {
  BETA_ORGANIZATION_SLUGS,
  NEWSLETTER_BETA_ORGANIZATION_SLUG,
} from "./beta-organizations.js";
import { SOCIAL_BETA_ORGANIZATION_SLUG } from "./social-beta.js";

describe("beta organizations", () => {
  it("keeps both feature slugs in the shared list", () => {
    expect(BETA_ORGANIZATION_SLUGS).toEqual({
      social: "utxo",
      newsletter: "utxo",
    });
    expect(SOCIAL_BETA_ORGANIZATION_SLUG).toBe(BETA_ORGANIZATION_SLUGS.social);
    expect(NEWSLETTER_BETA_ORGANIZATION_SLUG).toBe(
      BETA_ORGANIZATION_SLUGS.newsletter,
    );
  });
});
