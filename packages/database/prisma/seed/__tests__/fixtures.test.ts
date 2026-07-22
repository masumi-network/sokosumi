import { describe, expect, it } from "vitest";

import {
  FIXTURE_EMAILS,
  FIXTURE_ORG_SLUGS,
  FIXTURE_PASSWORD,
  SEED_COWORKER_SLUGS,
} from "../fixtures.js";

describe("seed fixtures", () => {
  it("exports expected fixture user emails", () => {
    expect(FIXTURE_EMAILS).toEqual({
      admin: "admin@sokosumi.local",
      alice: "alice@sokosumi.local",
      bob: "bob@sokosumi.local",
      carol: "carol@sokosumi.local",
    });
  });

  it("exports documented shared local password", () => {
    expect(FIXTURE_PASSWORD).toBe("Password123!");
  });

  it("exports org slugs", () => {
    expect(FIXTURE_ORG_SLUGS).toEqual({
      acme: "acme",
      bootstrap: "bootstrap",
    });
  });

  it("includes minimum coworker slugs from profile seed", () => {
    expect(SEED_COWORKER_SLUGS).toEqual(
      expect.arrayContaining(["elena", "alex", "hannah"]),
    );
    expect(SEED_COWORKER_SLUGS.length).toBeGreaterThanOrEqual(3);
  });
});
