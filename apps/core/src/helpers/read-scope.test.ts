import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UserAuthenticationContext } from "@/middleware/auth";

import {
  assertValidMemberIdFilter,
  buildScopedReadWhere,
  resolveUserReadScope,
} from "./read-scope";

const {
  getMemberByUserIdAndOrganizationIdMock,
  resolveWorkspaceForContextMock,
} = vi.hoisted(() => ({
  getMemberByUserIdAndOrganizationIdMock: vi.fn(),
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

vi.mock("@sokosumi/database/repositories", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/repositories")>();

  return {
    ...actual,
    memberRepository: {
      ...actual.memberRepository,
      getMemberByUserIdAndOrganizationId:
        getMemberByUserIdAndOrganizationIdMock,
    },
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
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValue({
      id: "member_123",
    });
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

  it("rejects memberId filters in personal workspaces", async () => {
    await expect(
      assertValidMemberIdFilter(
        {
          ...userAuthContext,
          organizationId: null,
        },
        "user_456",
        {} as never,
      ),
    ).rejects.toThrow("memberId is only supported in organization workspaces.");

    expect(getMemberByUserIdAndOrganizationIdMock).not.toHaveBeenCalled();
  });

  it("rejects memberId filters outside the active organization", async () => {
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValueOnce(null);
    const tx = {} as never;

    await expect(
      assertValidMemberIdFilter(userAuthContext, "user_456", tx),
    ).rejects.toThrow(
      "memberId must belong to the active organization workspace.",
    );

    expect(getMemberByUserIdAndOrganizationIdMock).toHaveBeenCalledWith(
      "user_456",
      "org_123",
      tx,
    );
  });

  it("accepts memberId filters for members in the active organization", async () => {
    const tx = {} as never;

    await expect(
      assertValidMemberIdFilter(userAuthContext, "user_456", tx),
    ).resolves.toBeUndefined();

    expect(getMemberByUserIdAndOrganizationIdMock).toHaveBeenCalledWith(
      "user_456",
      "org_123",
      tx,
    );
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
