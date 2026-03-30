import type { Prisma } from "../generated/prisma/client.js";

export const publicShareInclude = {
  job: true,
  task: true,
} as const;

export type PublicShareWithRelations = Prisma.PublicShareGetPayload<{
  include: typeof publicShareInclude;
}>;
