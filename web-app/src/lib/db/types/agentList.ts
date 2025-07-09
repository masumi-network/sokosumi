import { Prisma } from "@/prisma/generated/client";

import { agentInclude } from "./agent";

export const agentListInclude = {
  agents: {
    include: agentInclude,
  },
} as const;

export type AgentListWithAgent = Prisma.AgentListGetPayload<{
  include: typeof agentListInclude;
}>;
