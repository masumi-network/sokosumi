import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Prisma } from "../../generated/prisma/client.js";

const { getMemberByUserIdAndOrganizationIdMock } = vi.hoisted(() => ({
  getMemberByUserIdAndOrganizationIdMock: vi.fn(),
}));

vi.mock("../member.repository.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../member.repository.js")>();

  return {
    ...actual,
    memberRepository: {
      ...actual.memberRepository,
      getMemberByUserIdAndOrganizationId:
        getMemberByUserIdAndOrganizationIdMock,
    },
  };
});

import { workspaceRepository } from "../workspace.repository.js";

describe("workspaceRepository.findWorkspaceForContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not resolve an organization workspace without membership", async () => {
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValueOnce(null);
    const findUnique = vi.fn();

    const tx = {
      workspace: { findUnique },
    } as unknown as Prisma.TransactionClient;

    await expect(
      workspaceRepository.findWorkspaceForContext("user_1", "org_1", tx),
    ).resolves.toBeNull();

    expect(getMemberByUserIdAndOrganizationIdMock).toHaveBeenCalledWith(
      "user_1",
      "org_1",
      tx,
    );
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("resolves the organization workspace when the user is a member", async () => {
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValueOnce({ id: "m1" });
    const workspace = { id: "ws_org" };
    const findUnique = vi.fn().mockResolvedValueOnce(workspace);

    const tx = {
      workspace: { findUnique },
    } as unknown as Prisma.TransactionClient;

    await expect(
      workspaceRepository.findWorkspaceForContext("user_1", "org_1", tx),
    ).resolves.toBe(workspace);

    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it("does not check membership for personal workspaces", async () => {
    const workspace = { id: "ws_personal" };
    const findUnique = vi.fn().mockResolvedValueOnce(workspace);

    const tx = {
      workspace: { findUnique },
    } as unknown as Prisma.TransactionClient;

    await expect(
      workspaceRepository.findWorkspaceForContext("user_1", null, tx),
    ).resolves.toBe(workspace);

    expect(getMemberByUserIdAndOrganizationIdMock).not.toHaveBeenCalled();
  });
});

describe("workspaceRepository.upsertWorkspaceForContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("falls back to the personal workspace when org context has no membership", async () => {
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValueOnce(null);
    const upsert = vi.fn().mockResolvedValueOnce({ id: "ws_personal" });

    const tx = {
      workspace: { upsert },
    } as unknown as Prisma.TransactionClient;

    await workspaceRepository.upsertWorkspaceForContext("user_1", "org_1", tx);

    expect(getMemberByUserIdAndOrganizationIdMock).toHaveBeenCalledWith(
      "user_1",
      "org_1",
      tx,
    );
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user_1" },
      }),
    );
  });

  it("upserts the organization workspace when the user is a member", async () => {
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValueOnce({ id: "m1" });
    const upsert = vi.fn().mockResolvedValueOnce({ id: "ws_org" });

    const tx = {
      workspace: { upsert },
    } as unknown as Prisma.TransactionClient;

    await workspaceRepository.upsertWorkspaceForContext("user_1", "org_1", tx);

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org_1" },
      }),
    );
  });
});
