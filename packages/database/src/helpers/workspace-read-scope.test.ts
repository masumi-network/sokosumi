import { describe, expect, it } from "vitest";

import {
  buildWorkspaceReadWhere,
  canReadWorkspaceScopedRecord,
} from "./workspace-read-scope.js";

describe("workspace-read-scope", () => {
  it("builds owner-scoped where clauses for personal workspaces", () => {
    expect(
      buildWorkspaceReadWhere({
        workspaceId: "workspace_123",
        userId: "user_123",
        organizationId: null,
      }),
    ).toEqual({
      workspaceId: "workspace_123",
      userId: "user_123",
    });
  });

  it("builds workspace-wide where clauses for organization workspaces", () => {
    expect(
      buildWorkspaceReadWhere({
        workspaceId: "workspace_123",
        userId: "user_123",
        organizationId: "org_123",
      }),
    ).toEqual({
      workspaceId: "workspace_123",
    });
  });

  it("accepts only records inside the active scope", () => {
    expect(
      canReadWorkspaceScopedRecord(
        {
          workspaceId: "workspace_123",
          userId: "user_123",
        },
        {
          workspaceId: "workspace_123",
          userId: "user_123",
          organizationId: "org_123",
        },
      ),
    ).toBe(true);

    expect(
      canReadWorkspaceScopedRecord(
        {
          workspaceId: "workspace_456",
          userId: "user_123",
        },
        {
          workspaceId: "workspace_123",
          userId: "user_123",
          organizationId: "org_123",
        },
      ),
    ).toBe(false);
  });

  it("keeps personal workspace reads owner-scoped", () => {
    expect(
      canReadWorkspaceScopedRecord(
        {
          workspaceId: "workspace_123",
          userId: "user_123",
        },
        {
          workspaceId: "workspace_123",
          userId: "user_123",
          organizationId: null,
        },
      ),
    ).toBe(true);

    expect(
      canReadWorkspaceScopedRecord(
        {
          workspaceId: "workspace_123",
          userId: "user_456",
        },
        {
          workspaceId: "workspace_123",
          userId: "user_123",
          organizationId: null,
        },
      ),
    ).toBe(false);
  });

  it("supports member-scoped organization reads", () => {
    expect(
      buildWorkspaceReadWhere(
        {
          workspaceId: "workspace_123",
          userId: "user_123",
          organizationId: "org_123",
        },
        "user_456",
      ),
    ).toEqual({
      workspaceId: "workspace_123",
      userId: "user_456",
    });

    expect(
      canReadWorkspaceScopedRecord(
        {
          workspaceId: "workspace_123",
          userId: "user_456",
        },
        {
          workspaceId: "workspace_123",
          userId: "user_123",
          organizationId: "org_123",
        },
        "user_456",
      ),
    ).toBe(true);

    expect(
      canReadWorkspaceScopedRecord(
        {
          workspaceId: "workspace_123",
          userId: "user_789",
        },
        {
          workspaceId: "workspace_123",
          userId: "user_123",
          organizationId: "org_123",
        },
        "user_456",
      ),
    ).toBe(false);
  });
});
