import type { Prisma } from "../generated/prisma/client.js";

export const workspaceSummaryInclude = {
  organization: {
    select: {
      id: true,
      name: true,
      slug: true,
    },
  },
} as const;

export type WorkspaceWithRelations = Prisma.WorkspaceGetPayload<{
  include: typeof workspaceSummaryInclude;
}>;

export const workspaceRelationInclude = {
  workspace: {
    include: workspaceSummaryInclude,
  },
} as const;
