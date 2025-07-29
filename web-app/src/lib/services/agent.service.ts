import "server-only";

import { getEnvPublicConfig } from "@/config/env.public";
import {
  agentInclude,
  agentListInclude,
  AgentListWithAgents,
  agentOrderBy,
  AgentWithJobs,
  AgentWithRelations,
} from "@/lib/db/types";
import {
  AgentList,
  AgentListType,
  AgentStatus,
} from "@/prisma/generated/client";

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

  // Agent List Methods

  async createAgentListByUserIdAndType(
    userId: string,
    type: AgentListType,
  ): Promise<AgentListWithAgents> {
    return await this.client.agentList.create({
      data: {
        userId,
        type,
      },
      include: agentListInclude,
    });
  }

  async getAgentListByUserIdAndType(
    userId: string,
    type: AgentListType,
  ): Promise<AgentListWithAgents | null> {
    return await this.client.agentList.findUnique({
      where: {
        userId_type: {
          userId,
          type,
        },
      },
      include: agentListInclude,
    });
  }

  async addAgentToAgentListByIdAndUserId(
    agentId: string,
    listType: AgentListType,
    userId: string,
  ): Promise<AgentList> {
    return await this.client.agentList.update({
      where: { userId_type: { userId, type: listType } },
      data: {
        agents: { connect: { id: agentId } },
      },
    });
  }

  async removeAgentFromAgentListByIdAndUserId(
    agentId: string,
    listType: AgentListType,
    userId: string,
  ): Promise<AgentList> {
    return await this.client.agentList.update({
      where: { userId_type: { userId, type: listType } },
      data: {
        agents: { disconnect: { id: agentId } },
      },
    });
  }

  // Static Methods

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
