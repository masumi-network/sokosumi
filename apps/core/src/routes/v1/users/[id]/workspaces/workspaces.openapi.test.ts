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
    expect(doc.paths?.["/{id}/workspaces/preferred"]?.get).toBeDefined();
    expect(doc.paths?.["/{id}/workspaces/preferred"]?.put).toBeDefined();
    expect(doc.paths?.["/{id}/workspaces/{workspaceId}"]?.delete).toBeDefined();
    expect(doc.paths?.["/{id}"]?.patch).toBeDefined();
  });

  it("drops the replaced personal-workspace, workspace-access, and preferred-organization routes", () => {
    expect(doc.paths?.["/{id}/workspace-access"]).toBeUndefined();
    expect(doc.paths?.["/{id}/personal-workspace"]).toBeUndefined();
    expect(doc.paths?.["/{id}/preferred-organization"]).toBeUndefined();
  });

  it("keeps the organizations list current for coworkers", () => {
    expect(doc.paths?.["/{id}/organizations"]?.get?.deprecated).toBeUndefined();
  });
});
