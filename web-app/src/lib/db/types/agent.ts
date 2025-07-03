import { Prisma } from "@/prisma/generated/client";

export const agentPricingInclude = {
  pricing: {
    include: { fixedPricing: { include: { amounts: true } } },
  },
} as const;

export const agentRatingInclude = {
  rating: true,
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
} as const;

export const agentInclude = {
  ...agentPricingInclude,
  ...agentExampleOutputInclude,
  ...agentTagsInclude,
  ...agentRatingInclude,
  ...agentOrganizationsInclude,
} as const;

export type AgentWithRelations = Prisma.AgentGetPayload<{
  include: typeof agentInclude;
}>;

export type AgentWithFixedPricing = Prisma.AgentGetPayload<{
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

export interface AgentLegal {
  readonly privacyPolicy: string | null;
  readonly terms: string | null;
  readonly other: string | null;
}
