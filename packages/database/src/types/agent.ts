import type { Prisma } from "../generated/prisma/client.js";

export const agentMetadataOverrideScalarsInclude = {
  metadataOverride: true,
} as const;

export const agentMetadataOverrideDetailInclude = {
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

export const agentPricingInclude = {
  pricing: {
    include: { fixedPricing: { include: { amounts: true } } },
  },
} as const;

export const agentRatingInclude = {
  userAgentRating: true,
} as const;

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

export const agentCategoriesInclude = {
  categories: true,
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

export const agentJobsInclude = {
  jobs: true,
} as const;

export const agentInclude = {
  ...agentPricingInclude,
  ...agentExampleOutputInclude,
  ...agentTagsInclude,
  ...agentCategoriesInclude,
  ...agentRatingInclude,
} as const;

export const agentJobsCountOrderBy = {
  jobs: {
    _count: "desc",
  },
} as const;

export const agentCreatedAtOrderBy = {
  createdAt: "desc",
} as const;

export const agentOrderBy = [
  { ...agentJobsCountOrderBy },
  { ...agentCreatedAtOrderBy },
] as const;

export type AgentWithCreditsPrice = Prisma.AgentGetPayload<{
  include: typeof agentInclude;
}> & {
  creditsPrice: {
    cents: bigint;
  };
};

export type AgentWithRelations = Prisma.AgentGetPayload<{
  include: typeof agentInclude;
}>;

export type AgentWithPricing = Prisma.AgentGetPayload<{
  include: typeof agentPricingInclude;
}>;

export type AgentWithRating = Prisma.AgentGetPayload<{
  include: typeof agentRatingInclude;
}>;

export type AgentWithTags = Prisma.AgentGetPayload<{
  include: typeof agentTagsInclude;
}>;

export type AgentWithCategories = Prisma.AgentGetPayload<{
  include: typeof agentCategoriesInclude;
}>;

export type AgentWithExampleOutput = Prisma.AgentGetPayload<{
  include: typeof agentExampleOutputInclude;
}>;

export type AgentWithJobs = Prisma.AgentGetPayload<{
  include: typeof agentJobsInclude;
}>;

export type AgentWithMetadataOverride = Prisma.AgentGetPayload<{
  include: typeof agentMetadataOverrideScalarsInclude;
}>;

export type AgentWithMetadataOverrideDetail = Prisma.AgentGetPayload<{
  include: typeof agentMetadataOverrideDetailInclude;
}>;
