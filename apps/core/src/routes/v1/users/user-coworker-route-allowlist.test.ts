import { describe, expect, it } from "vitest";

import {
  isAgentAllowedUserSubpath,
  isAgentSelfFilteringUserSubpath,
  userRouteSubpathAfterId,
} from "./user-coworker-route-allowlist";

describe("userRouteSubpathAfterId", () => {
  it("strips the user id segment from nested paths", () => {
    expect(userRouteSubpathAfterId("/me/credits", "me")).toBe("/credits");
    expect(
      userRouteSubpathAfterId("/usr_1/organizations/org_1/member", "usr_1"),
    ).toBe("/organizations/org_1/member");
  });

  it("matches the id as a full path segment, not a substring", () => {
    expect(userRouteSubpathAfterId("/v1/users/me/credits", "me")).toBe(
      "/credits",
    );
    expect(userRouteSubpathAfterId("/v1/users/users/credits", "users")).toBe(
      "/credits",
    );
    expect(
      userRouteSubpathAfterId("/v1/users/me/organizations/me/member", "me"),
    ).toBe("/organizations/me/member");
  });

  it("returns root for the bare user path", () => {
    expect(userRouteSubpathAfterId("/me", "me")).toBe("/");
    expect(userRouteSubpathAfterId("/me/", "me")).toBe("/");
  });
});

describe("isAgentAllowedUserSubpath", () => {
  it("allows profile, credits, organization list/credits, and workspace list reads", () => {
    expect(isAgentAllowedUserSubpath("/")).toBe(true);
    expect(isAgentAllowedUserSubpath("/credits")).toBe(true);
    expect(isAgentAllowedUserSubpath("/organizations")).toBe(true);
    expect(isAgentAllowedUserSubpath("/organizations/org_1/credits")).toBe(
      true,
    );
    expect(isAgentAllowedUserSubpath("/workspaces")).toBe(true);
    expect(isAgentAllowedUserSubpath("/workspaces/preferred")).toBe(true);
  });

  it("rejects other user subpaths", () => {
    expect(isAgentAllowedUserSubpath("/preferences")).toBe(false);
    expect(isAgentAllowedUserSubpath("/billing-details")).toBe(false);
    expect(isAgentAllowedUserSubpath("/organizations/org_1")).toBe(false);
    expect(isAgentAllowedUserSubpath("/organizations/org_1/member")).toBe(
      false,
    );
    expect(isAgentAllowedUserSubpath("/files")).toBe(false);
    expect(isAgentAllowedUserSubpath("/deletion")).toBe(false);
    expect(isAgentAllowedUserSubpath("/pending-organization-invitations")).toBe(
      false,
    );
  });
});

describe("isAgentSelfFilteringUserSubpath", () => {
  it("marks only the workspace reads as filtering their own result", () => {
    expect(isAgentSelfFilteringUserSubpath("/workspaces")).toBe(true);
    expect(isAgentSelfFilteringUserSubpath("/workspaces/")).toBe(true);
    expect(isAgentSelfFilteringUserSubpath("/workspaces/preferred")).toBe(true);
    expect(
      isAgentSelfFilteringUserSubpath(
        "/workspaces/11111111-1111-7111-8111-111111111111",
      ),
    ).toBe(false);
    expect(isAgentSelfFilteringUserSubpath("/organizations")).toBe(false);
  });
});
