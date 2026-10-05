import { describe, expect, it } from "vitest";

import usersRouter from "../../index";

const doc = usersRouter.getOpenAPI31Document({
  openapi: "3.1.0",
  info: { title: "Users API", version: "1.0.0" },
});

describe("users workspaces OpenAPI contract (ADR 0051)", () => {
  it("exposes the workspaces resource and the name update", () => {
    expect(doc.paths?.["/{id}/workspaces"]?.get).toBeDefined();
    expect(doc.paths?.["/{id}/workspaces"]?.post).toBeDefined();
    expect(doc.paths?.["/{id}/workspaces/preferred"]?.put).toBeDefined();
    expect(doc.paths?.["/{id}"]?.patch).toBeDefined();
  });

  it.each([
    ["/{id}/workspace-access", "get"],
    ["/{id}/personal-workspace", "post"],
    ["/{id}/preferred-organization", "get"],
    ["/{id}/preferred-organization", "put"],
  ] as const)("keeps %s %s as a deprecated fallback", (path, method) => {
    expect(doc.paths?.[path]?.[method]?.deprecated).toBe(true);
  });

  it("keeps the organizations list current for coworkers", () => {
    expect(doc.paths?.["/{id}/organizations"]?.get?.deprecated).toBeUndefined();
  });
});
