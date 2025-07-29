import "server-only";

import { AgentList } from "@/prisma/generated/client";

import { BaseService } from "./base.service";

export class AgentListService extends BaseService<AgentListService> {
  async getAgentListById(id: string): Promise<AgentList | null> {
    return this.client.agentList.findUnique({ where: { id } });
  }
}
