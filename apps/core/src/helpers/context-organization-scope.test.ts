import { describe, expect, it } from "vitest";

import type { UserContext } from "@/middleware/auth";

import {
  assertOrganizationInContextScope,
  contextOrganizationMemberFilter,
} from "./context-organization-scope";

const SESSION_CONTEXT: UserContext = {
  source: "session",
  actor: "user",
  userId: "user_123",
  organizationId: "org_a",
  role: "user",
};

function contextActor(organizationId: string | null): UserContext {
  return { source: "context", userId: "user_123", organizationId };
}

describe("assertOrganizationInContextScope", () => {
  it("allows a session user to target an organization other than the active one", () => {
    expect(() =>
      assertOrganizationInContextScope(SESSION_CONTEXT, "org_b"),
    ).not.toThrow();
  });

  it("allows a context actor to target its own organization", () => {
    expect(() =>
      assertOrganizationInContextScope(contextActor("org_a"), "org_a"),
    ).not.toThrow();
  });

  it("rejects a context actor targeting another organization", () => {
    expect(() =>
      assertOrganizationInContextScope(contextActor("org_a"), "org_b"),
    ).toThrowError(/not authorized for this organization/);
  });

  it("rejects every organization for a personal workspace context", () => {
    expect(() =>
      assertOrganizationInContextScope(contextActor(null), "org_a"),
    ).toThrowError(/not authorized for this organization/);
  });
});

describe("contextOrganizationMemberFilter", () => {
  it("does not narrow the listing for a session user", () => {
    expect(contextOrganizationMemberFilter(SESSION_CONTEXT)).toEqual({});
  });

  it("narrows the listing to the bound organization for a context actor", () => {
    expect(contextOrganizationMemberFilter(contextActor("org_a"))).toEqual({
      organizationId: "org_a",
    });
  });

  it("matches no organization for a personal workspace context", () => {
    expect(contextOrganizationMemberFilter(contextActor(null))).toEqual({
      organizationId: { in: [] },
    });
  });
});
