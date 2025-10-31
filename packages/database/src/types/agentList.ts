import type { Prisma } from "../generated/prisma/client";
import { agentInclude } from "./agent";

export const agentListInclude = {
  agents: {
    include: agentInclude,
  },
} as const;

export type AgentListWithAgents = Prisma.AgentListGetPayload<{
  include: typeof agentListInclude;
}>;
