import { describe, expect, it, vi } from "vitest";

import type { Prisma } from "../../generated/prisma/client.js";
import { agentRepository } from "../agent.repository.js";

describe("agentRepository.getHiredAgentsWithLatestJobByUserIdAndWorkspace", () => {
  it("scopes hired agents to the active workspace", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const tx = {
      agent: {
        findMany,
      },
    } as unknown as Prisma.TransactionClient;

    await agentRepository.getHiredAgentsWithLatestJobByUserIdAndWorkspace(
      "user-1",
      "workspace-1",
      tx,
    );

    expect(findMany).toHaveBeenCalledWith({
      where: {
        jobs: {
          some: {
            userId: "user-1",
            workspaceId: "workspace-1",
          },
        },
      },
      include: {
        jobs: {
          where: {
            userId: "user-1",
            workspaceId: "workspace-1",
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });
  });
});

describe("agentRepository.getHiredAgentsWithLatestJobByWorkspaceScope", () => {
  it("uses workspace-wide reads for organization workspaces", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const tx = {
      agent: {
        findMany,
      },
    } as unknown as Prisma.TransactionClient;

    await agentRepository.getHiredAgentsWithLatestJobByWorkspaceScope(
      {
        workspaceId: "workspace-1",
        ownerUserId: null,
      },
      tx,
    );

    expect(findMany).toHaveBeenCalledWith({
      where: {
        jobs: {
          some: {
            workspaceId: "workspace-1",
          },
        },
      },
      include: {
        jobs: {
          where: {
            workspaceId: "workspace-1",
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });
  });

  it("keeps personal workspaces owner-scoped", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const tx = {
      agent: {
        findMany,
      },
    } as unknown as Prisma.TransactionClient;

    await agentRepository.getHiredAgentsWithLatestJobByWorkspaceScope(
      {
        workspaceId: "workspace-1",
        ownerUserId: "user-1",
      },
      tx,
    );

    expect(findMany).toHaveBeenCalledWith({
      where: {
        jobs: {
          some: {
            workspaceId: "workspace-1",
            userId: "user-1",
          },
        },
      },
      include: {
        jobs: {
          where: {
            workspaceId: "workspace-1",
            userId: "user-1",
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });
  });
});
