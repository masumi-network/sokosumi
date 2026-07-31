import { describe, expect, it } from "vitest";

import {
  isCoworkerAllowedUserSubpath,
  userRouteSubpathAfterId,
} from "./user-coworker-route-allowlist";

describe("userRouteSubpathAfterId", () => {
  it("strips the user id segment from nested paths", () => {
    expect(userRouteSubpathAfterId("/me/credits", "me")).toBe("/credits");
    expect(
      userRouteSubpathAfterId("/usr_1/organizations/org_1/member", "usr_1"),
    ).toBe("/organizations/org_1/member");
  });

  it("returns root for the bare user path", () => {
    expect(userRouteSubpathAfterId("/me", "me")).toBe("/");
    expect(userRouteSubpathAfterId("/me/", "me")).toBe("/");
  });
});

describe("isCoworkerAllowedUserSubpath", () => {
  it("allows credits and organization membership reads", () => {
    expect(isCoworkerAllowedUserSubpath("/credits")).toBe(true);
    expect(isCoworkerAllowedUserSubpath("/organizations")).toBe(true);
    expect(isCoworkerAllowedUserSubpath("/organizations/org_1/credits")).toBe(
      true,
    );
    expect(isCoworkerAllowedUserSubpath("/organizations/org_1/member")).toBe(
      true,
    );
  });

  it("rejects other user subpaths", () => {
    expect(isCoworkerAllowedUserSubpath("/")).toBe(false);
    expect(isCoworkerAllowedUserSubpath("/preferences")).toBe(false);
    expect(isCoworkerAllowedUserSubpath("/billing-details")).toBe(false);
    expect(isCoworkerAllowedUserSubpath("/organizations/org_1")).toBe(false);
    expect(isCoworkerAllowedUserSubpath("/files")).toBe(false);
  });
});
