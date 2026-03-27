import { describe, expect, it, vi } from "vitest";

import type { Prisma } from "../../generated/prisma/client.js";
import { agentRepository } from "../agent.repository.js";

describe("agentRepository.getHiredAgentsWithLatestJobByUserIdAndOrganization", () => {
  it("scopes hired agents to the active organization context", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const tx = {
      agent: {
        findMany,
      },
    } as unknown as Prisma.TransactionClient;

    await agentRepository.getHiredAgentsWithLatestJobByUserIdAndOrganization(
      "user-1",
      "org-1",
      tx,
    );

    expect(findMany).toHaveBeenCalledWith({
      where: {
        jobs: {
          some: {
            userId: "user-1",
            organizationId: "org-1",
          },
        },
      },
      include: {
        jobs: {
          where: {
            userId: "user-1",
            organizationId: "org-1",
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });
  });

  it("scopes hired agents to the personal workspace when no organization is active", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const tx = {
      agent: {
        findMany,
      },
    } as unknown as Prisma.TransactionClient;

    await agentRepository.getHiredAgentsWithLatestJobByUserIdAndOrganization(
      "user-1",
      null,
      tx,
    );

    expect(findMany).toHaveBeenCalledWith({
      where: {
        jobs: {
          some: {
            userId: "user-1",
            organizationId: null,
          },
        },
      },
      include: {
        jobs: {
          where: {
            userId: "user-1",
            organizationId: null,
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });
  });
});
