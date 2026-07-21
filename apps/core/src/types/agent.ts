import { type Prisma } from "@sokosumi/database";

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

export const agentPricingInclude = {
  pricing: {
    include: { fixedPricing: { include: { amounts: true } } },
  },
} as const;

export type AgentWithPricing = Prisma.AgentGetPayload<{
  include: typeof agentPricingInclude;
}>;

export const agentJobsCountInclude = {
  _count: {
    select: {
      jobs: true,
    },
  },
} as const;

export type AgentWithJobsCount = Prisma.AgentGetPayload<{
  include: typeof agentJobsCountInclude;
}>;

export const agentCategoriesInclude = {
  categories: {
    orderBy: [
      { priority: "asc" },
      { name: "asc" },
    ] as Prisma.CategoryOrderByWithRelationInput[],
  },
} as const;

export type AgentWithCategories = Prisma.AgentGetPayload<{
  include: typeof agentCategoriesInclude;
}>;

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

export type AgentWithTags = Prisma.AgentGetPayload<{
  include: typeof agentTagsInclude;
}>;

export const agentExampleOutputInclude = {
  exampleOutput: {
    orderBy: [
      { createdAt: "asc" },
      { id: "asc" },
    ] as Prisma.ExampleOutputOrderByWithRelationInput[],
  },
  ...agentMetadataOverrideRelationsInclude,
} as const;

export type AgentWithExampleOutput = Prisma.AgentGetPayload<{
  include: typeof agentExampleOutputInclude;
}>;

export const agentDetailInclude = {
  ...agentPricingInclude,
  ...agentJobsCountInclude,
  ...agentCategoriesInclude,
  ...agentTagsInclude,
  ...agentExampleOutputInclude,
} as const;

export type AgentWithDetailRelations = Prisma.AgentGetPayload<{
  include: typeof agentDetailInclude;
}>;
