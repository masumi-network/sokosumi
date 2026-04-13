import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Prisma } from "../../generated/prisma/client.js";

import { workspaceRepository } from "../workspace.repository.js";

describe("workspaceRepository.getPersonalWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("looks up the workspace by user id", async () => {
    const workspace = { id: "ws_personal" };
    const findUnique = vi.fn().mockResolvedValueOnce(workspace);

    const tx = {
      workspace: { findUnique },
    } as unknown as Prisma.TransactionClient;

    await expect(
      workspaceRepository.getPersonalWorkspace("user_1", tx),
    ).resolves.toBe(workspace);

    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user_1" },
      }),
    );
  });
});

describe("workspaceRepository.getOrganizationWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("looks up the workspace by organization id", async () => {
    const workspace = { id: "ws_org" };
    const findUnique = vi.fn().mockResolvedValueOnce(workspace);

    const tx = {
      workspace: { findUnique },
    } as unknown as Prisma.TransactionClient;

    await expect(
      workspaceRepository.getOrganizationWorkspace("org_1", tx),
    ).resolves.toBe(workspace);

    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org_1" },
      }),
    );
  });
});

describe("workspaceRepository.upsertPersonalWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("upserts the workspace by user id", async () => {
    const upsert = vi.fn().mockResolvedValueOnce({ id: "ws_personal" });

    const tx = {
      workspace: { upsert },
    } as unknown as Prisma.TransactionClient;

    await workspaceRepository.upsertPersonalWorkspace("user_1", tx);

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user_1" },
      }),
    );
  });
});

describe("workspaceRepository.upsertOrganizationWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("upserts the workspace by organization id", async () => {
    const upsert = vi.fn().mockResolvedValueOnce({ id: "ws_org" });

    const tx = {
      workspace: { upsert },
    } as unknown as Prisma.TransactionClient;

    await workspaceRepository.upsertOrganizationWorkspace("org_1", tx);

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org_1" },
      }),
    );
  });
});
