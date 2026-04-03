import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UserAuthenticationContext } from "@/middleware/auth";

import { buildScopedReadWhere, resolveUserReadScope } from "./read-scope";

const { resolveWorkspaceForContextMock } = vi.hoisted(() => ({
  resolveWorkspaceForContextMock: vi.fn(),
}));

vi.mock("@sokosumi/database/helpers", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/helpers")>();

  return {
    ...actual,
    resolveWorkspaceForContext: resolveWorkspaceForContextMock,
  };
});

const userAuthContext: UserAuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: "org_123",
};

describe("read-scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves org workspaces as workspace-wide read scope", async () => {
    resolveWorkspaceForContextMock.mockResolvedValueOnce({
      id: "11111111-1111-7111-8111-111111111111",
    });

    await expect(resolveUserReadScope(userAuthContext)).resolves.toEqual({
      workspaceId: "11111111-1111-7111-8111-111111111111",
      ownerUserId: null,
      organizationId: "org_123",
    });
  });

  it("keeps personal workspaces owner-scoped", async () => {
    resolveWorkspaceForContextMock.mockResolvedValueOnce({
      id: "22222222-2222-7222-8222-222222222222",
    });

    await expect(
      resolveUserReadScope({
        ...userAuthContext,
        organizationId: null,
      }),
    ).resolves.toEqual({
      workspaceId: "22222222-2222-7222-8222-222222222222",
      ownerUserId: "user_123",
      organizationId: null,
    });
  });

  it("builds a member-filtered org read clause", () => {
    expect(
      buildScopedReadWhere(
        {
          workspaceId: "workspace_123",
          ownerUserId: null,
          organizationId: "org_123",
        },
        "user_456",
      ),
    ).toEqual({
      workspaceId: "workspace_123",
      userId: "user_456",
    });
  });

  it("builds a personal owner-scoped read clause", () => {
    expect(
      buildScopedReadWhere({
        workspaceId: "workspace_123",
        ownerUserId: "user_123",
        organizationId: null,
      }),
    ).toEqual({
      workspaceId: "workspace_123",
      userId: "user_123",
    });
  });
});
