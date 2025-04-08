import { Prisma } from "@prisma/client";

export const agentListInclude = {
  agents: true,
} as const;

export type AgentListWithAgent = Prisma.AgentListGetPayload<{
  include: typeof agentListInclude;
}>;
