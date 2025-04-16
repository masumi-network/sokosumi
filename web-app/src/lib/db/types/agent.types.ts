import { Prisma } from "@/prisma/generated/client";

export const agentPricingInclude = {
  pricing: {
    include: { fixedPricing: { include: { amounts: true } } },
  },
} as const;

export const agentInclude = {
  ...agentPricingInclude,
  exampleOutput: true,
  overrideExampleOutput: true,
  tags: true,
  overrideTags: true,
  rating: true,
  userAgentRating: true,
} as const;

export type AgentWithRelations = Prisma.AgentGetPayload<{
  include: typeof agentInclude;
}>;
