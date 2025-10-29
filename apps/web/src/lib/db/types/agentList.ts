import { Prisma } from "@sokosumi/database";

import { agentInclude } from "./agent";

export const agentListInclude = {
  agents: {
    include: agentInclude,
  },
} as const;

export type AgentListWithAgents = Prisma.AgentListGetPayload<{
  include: typeof agentListInclude;
}>;
