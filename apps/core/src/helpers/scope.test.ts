import { describe, expect, it } from "vitest";

import type { AuthenticationContext } from "@/middleware/auth";

import {
  buildJobScopeFilters,
  jobScopeQuerySchema,
  resolveJobScopes,
  resolveTaskScopes,
  taskScopeQuerySchema,
} from "./scope";

const userAuthContext: AuthenticationContext = {
  userId: "user_123",
  organizationId: "org_123",
  coworkerId: null,
};

const coworkerAuthContext: AuthenticationContext = {
  userId: "user_123",
  organizationId: "org_123",
  coworkerId: "cow_123",
};

describe("resolveTaskScopes", () => {
  it("defaults to context when scope query is missing", () => {
    expect(resolveTaskScopes(userAuthContext, undefined)).toEqual(["context"]);
  });
});

describe("resolveJobScopes", () => {
  it("deduplicates scopes resolved from zod-validated input", () => {
    expect(resolveJobScopes(userAuthContext, ["context", "shared", "context"])).toEqual(
      ["context", "shared"],
    );
  });

  it("forces coworker-authenticated requests to context scope", () => {
    expect(resolveJobScopes(coworkerAuthContext, ["owned", "shared"])).toEqual([
      "context",
    ]);
  });
});

describe("scope query schema", () => {
  it("parses comma-separated task scopes into a typed array", () => {
    expect(taskScopeQuerySchema.parse("context,owned")).toEqual([
      "context",
      "owned",
    ]);
  });

  it("parses repeated job query values into a typed array", () => {
    expect(jobScopeQuerySchema.parse(["context", "shared,owned"])).toEqual([
      "context",
      "shared",
      "owned",
    ]);
  });

  it("rejects unknown scope values", () => {
    expect(() => taskScopeQuerySchema.parse("context,unknown")).toThrow();
  });

  it("rejects empty scope values", () => {
    expect(() => taskScopeQuerySchema.parse("context,")).toThrow();
  });
});

describe("buildJobScopeFilters", () => {
  it("builds context and shared filters with OR-compatible clauses", () => {
    expect(buildJobScopeFilters(userAuthContext, ["context", "shared"]))
      .toEqual([
        { userId: "user_123", organizationId: "org_123" },
        { share: { organizationId: "org_123" } },
      ]);
  });

  it("omits shared filter when organization context is missing", () => {
    const personalContext: AuthenticationContext = {
      userId: "user_123",
      organizationId: null,
      coworkerId: null,
    };

    expect(buildJobScopeFilters(personalContext, ["shared"])).toEqual([]);
  });
});
