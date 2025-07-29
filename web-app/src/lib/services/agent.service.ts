import "server-only";

import { getEnvPublicConfig } from "@/config/env.public";
import {
  agentInclude,
  agentOrderBy,
  AgentWithJobs,
  AgentWithRelations,
} from "@/lib/db/types";
import { AgentStatus } from "@/prisma/generated/client";

import { BaseService } from "./base.service";

export class AgentService extends BaseService<AgentService> {
  private static thresholdDays =
    getEnvPublicConfig().NEXT_PUBLIC_AGENT_NEW_THRESHOLD_DAYS;

  async getAgentsWithRelations(): Promise<AgentWithRelations[]> {
    const agents = await this.client.agent.findMany({
      include: agentInclude,
    });

    return agents.map(AgentService.mapAgentWithIsNew);
  }

  async getAgentWithRelationsById(
    id: string,
  ): Promise<AgentWithRelations | null> {
    const agent = await this.client.agent.findUnique({
      where: { id },
      include: agentInclude,
    });

    if (!agent) {
      return null;
    }

    return AgentService.mapAgentWithIsNew(agent);
  }

  async getShownAgentWithRelationById(
    agentId: string,
    status: AgentStatus,
  ): Promise<AgentWithRelations | null> {
    const agent = await this.client.agent.findUnique({
      where: { id: agentId, isShown: true, status },
      include: agentInclude,
    });

    if (!agent) {
      return null;
    }

    return AgentService.mapAgentWithIsNew(agent);
  }

  async getShownAgentsWithRelationsByStatus(
    status: AgentStatus,
  ): Promise<AgentWithRelations[]> {
    const agents = await this.client.agent.findMany({
      include: agentInclude,
      orderBy: [...agentOrderBy],
      where: {
        status,
        isShown: true,
      },
    });

    return agents.map(AgentService.mapAgentWithIsNew);
  }

  async getHiredAgentsWithJobsByUserIdAndOrganization(
    userId: string,
    organizationId: string | null | undefined,
  ): Promise<AgentWithJobs[]> {
    const normalizedOrganizationId = organizationId ?? null;
    return await this.client.agent.findMany({
      where: {
        jobs: {
          some: {
            userId,
            organizationId: normalizedOrganizationId,
          },
        },
      },
      include: {
        jobs: {
          where: {
            userId,
            organizationId: normalizedOrganizationId,
          },
          orderBy: {
            startedAt: "desc",
          },
          take: 1,
        },
      },
    });
  }

  static mapAgentWithIsNew(
    agent: Omit<AgentWithRelations, "isNew">,
  ): AgentWithRelations {
    const thresholdMilliseconds = 86_400_000 * AgentService.thresholdDays;

    return {
      ...agent,
      isNew: agent.createdAt > new Date(Date.now() - thresholdMilliseconds),
    };
  }
}
