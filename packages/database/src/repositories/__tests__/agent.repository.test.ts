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
            ownerId: "user-1",
            workspaceId: "workspace-1",
          },
        },
      },
      include: {
        jobs: {
          where: {
            ownerId: "user-1",
            workspaceId: "workspace-1",
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });
  });
});
