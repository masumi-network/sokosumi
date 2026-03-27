import { describe, expect, it } from "vitest";

import type { UserAuthenticationContext } from "@/middleware/auth";

import {
  buildJobScopeFilters,
  buildTaskScopeFilters,
  jobScopeQuerySchema,
  taskScopeQuerySchema,
} from "./scope";

const userAuthContext: UserAuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: "org_123",
};

describe("scope query schema", () => {
  it("parses comma-separated task scopes into a typed array", () => {
    expect(taskScopeQuerySchema.parse("context,owned")).toEqual([
      "context",
      "owned",
    ]);
  });

  it("parses repeated job query values into a typed array", () => {
    expect(jobScopeQuerySchema.parse(["context", "owned"])).toEqual([
      "context",
      "owned",
    ]);
  });

  it("rejects unknown scope values", () => {
    expect(() => taskScopeQuerySchema.parse("context,unknown")).toThrow();
  });

  it("rejects empty scope values", () => {
    expect(() => taskScopeQuerySchema.parse("context,")).toThrow();
  });

  it("rejects removed shared job scope values", () => {
    expect(() => jobScopeQuerySchema.parse("shared")).toThrow();
  });
});

describe("buildJobScopeFilters", () => {
  it("defaults to context scope when scopes are missing", () => {
    expect(buildJobScopeFilters(userAuthContext)).toEqual([
      { userId: "user_123", organizationId: "org_123" },
    ]);
  });

  it("builds context and owned filters with OR-compatible clauses", () => {
    expect(buildJobScopeFilters(userAuthContext, ["context", "owned"])).toEqual(
      [
        { userId: "user_123", organizationId: "org_123" },
        { userId: "user_123" },
      ],
    );
  });

  it("keeps personal context scope when organization context is missing", () => {
    const personalContext: UserAuthenticationContext = {
      actor: "user",
      userId: "user_123",
      organizationId: null,
    };

    expect(buildJobScopeFilters(personalContext, ["context"])).toEqual([
      { userId: "user_123", organizationId: null },
    ]);
  });
});

describe("buildTaskScopeFilters", () => {
  it("defaults to context scope when scopes are missing", () => {
    expect(buildTaskScopeFilters(userAuthContext)).toEqual([
      { userId: "user_123", organizationId: "org_123" },
    ]);
  });

  it("supports owned scope", () => {
    expect(buildTaskScopeFilters(userAuthContext, ["owned"])).toEqual([
      { userId: "user_123" },
    ]);
  });
});
