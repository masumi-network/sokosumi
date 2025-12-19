import { JobType, type Prisma } from "@sokosumi/database";

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

export const agentOrganizationsInclude = {
  organizations: true,
  blacklistedOrganizations: true,
} as const;

export type AgentWithOrganizations = Prisma.AgentGetPayload<{
  include: typeof agentOrganizationsInclude;
}>;

export const agentJobsCountInclude = {
  _count: {
    select: {
      jobs: {
        where: {
          jobType: {
            not: JobType.DEMO,
          },
        },
      },
    },
  },
} as const;

export type AgentWithJobsCount = Prisma.AgentGetPayload<{
  include: typeof agentJobsCountInclude;
}>;
