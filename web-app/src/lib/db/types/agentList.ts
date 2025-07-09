import { Prisma } from "@/prisma/generated/client";

import { agentOrganizationsInclude, agentPricingInclude } from "./agent";

export const agentListInclude = {
  agents: {
    include: {
      ...agentOrganizationsInclude,
      ...agentPricingInclude,
    },
  },
} as const;

export type AgentListWithAgent = Prisma.AgentListGetPayload<{
  include: typeof agentListInclude;
}>;
