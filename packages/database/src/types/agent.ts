import type { Prisma } from "../generated/prisma/client.js";

export const agentMetadataOverrideScalarsInclude = {
  metadataOverride: true,
} as const;

export const agentPricingInclude = {
  pricing: {
    include: { fixedPricing: { include: { amounts: true } } },
  },
} as const;

/** Override row with tags + exampleOutputs (order matches marketplace merge). */
export const agentMetadataOverrideRelationsInclude = {
  metadataOverride: {
    include: {
      tags: {
        orderBy: [{ name: "asc" }] as Prisma.TagOrderByWithRelationInput[],
      },
      exampleOutputs: {
        orderBy: [
          { createdAt: "asc" },
          { id: "asc" },
        ] as Prisma.ExampleOutputOrderByWithRelationInput[],
      },
    },
  },
} as const;

export const agentTagsInclude = {
  tags: {
    orderBy: [{ name: "asc" }] as Prisma.TagOrderByWithRelationInput[],
  },
  ...agentMetadataOverrideRelationsInclude,
} as const;

export const agentExampleOutputInclude = {
  exampleOutput: {
    orderBy: [
      { createdAt: "asc" },
      { id: "asc" },
    ] as Prisma.ExampleOutputOrderByWithRelationInput[],
  },
  ...agentMetadataOverrideRelationsInclude,
} as const;

export const agentJobCountOrderBy = {
  jobCount: "desc",
} as const;

export const agentCreatedAtOrderBy = {
  createdAt: "desc",
} as const;

export const agentOrderBy = [
  { ...agentJobCountOrderBy },
  { ...agentCreatedAtOrderBy },
] as const;

export type AgentWithPricing = Prisma.AgentGetPayload<{
  include: typeof agentPricingInclude;
}>;
