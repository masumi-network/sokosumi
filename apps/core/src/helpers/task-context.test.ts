import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UserAuthenticationContext } from "@/middleware/auth";

import { buildCurrentWorkspaceTaskContextWhere } from "./task-context";

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

describe("buildCurrentWorkspaceTaskContextWhere", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds the current user workspace filter", async () => {
    resolveWorkspaceForContextMock.mockResolvedValueOnce({
      id: "11111111-1111-7111-8111-111111111111",
    });

    await expect(
      buildCurrentWorkspaceTaskContextWhere(userAuthContext),
    ).resolves.toEqual({
      workspaceId: "11111111-1111-7111-8111-111111111111",
    });
  });

  it("keeps personal context when organization is null", async () => {
    resolveWorkspaceForContextMock.mockResolvedValueOnce({
      id: "22222222-2222-7222-8222-222222222222",
    });

    await expect(
      buildCurrentWorkspaceTaskContextWhere({
        ...userAuthContext,
        organizationId: null,
      }),
    ).resolves.toEqual({
      workspaceId: "22222222-2222-7222-8222-222222222222",
    });
  });
});
