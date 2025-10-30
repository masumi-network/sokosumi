import type { Prisma } from "../generated/prisma/client";

export const agentPricingInclude = {
  pricing: {
    include: { fixedPricing: { include: { amounts: true } } },
  },
} as const;

export const agentRatingInclude = {
  userAgentRating: true,
} as const;

export const agentTagsInclude = {
  tags: true,
  overrideTags: true,
} as const;

export const agentExampleOutputInclude = {
  exampleOutput: true,
  overrideExampleOutput: true,
} as const;

export const agentJobsInclude = {
  jobs: true,
} as const;

export const agentOrganizationsInclude = {
  organizations: true,
  blacklistedOrganizations: true,
} as const;

export const agentInclude = {
  ...agentPricingInclude,
  ...agentExampleOutputInclude,
  ...agentTagsInclude,
  ...agentRatingInclude,
  ...agentOrganizationsInclude,
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
    includedFee: bigint;
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

export type AgentWithExampleOutput = Prisma.AgentGetPayload<{
  include: typeof agentExampleOutputInclude;
}>;

export type AgentWithJobs = Prisma.AgentGetPayload<{
  include: typeof agentJobsInclude;
}>;

export type AgentWithOrganizations = Prisma.AgentGetPayload<{
  include: typeof agentOrganizationsInclude;
}>;
