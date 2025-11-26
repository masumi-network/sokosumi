import type { Prisma } from "../generated/prisma/client.js";
import { agentInclude } from "./agent.js";

export const agentListInclude = {
  agents: {
    include: agentInclude,
  },
} as const;

export type AgentListWithAgents = Prisma.AgentListGetPayload<{
  include: typeof agentListInclude;
}>;
