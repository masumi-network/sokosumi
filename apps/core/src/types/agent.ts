import {
  agentExampleOutputInclude,
  agentPricingInclude,
  agentTagsInclude,
  type Prisma,
} from "@sokosumi/database";

/** Catalog list needs stable category order; shared package include is unordered. */
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

export const agentDetailInclude = {
  ...agentPricingInclude,
  ...agentCategoriesInclude,
  ...agentTagsInclude,
  ...agentExampleOutputInclude,
} as const;

export type AgentWithDetailRelations = Prisma.AgentGetPayload<{
  include: typeof agentDetailInclude;
}>;
