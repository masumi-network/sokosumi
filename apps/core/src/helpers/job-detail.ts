import { jobInclude, type Prisma } from "@sokosumi/database";

import { loadJobSharedRelations } from "@/helpers/job";
import {
  type NetworkScope,
  networkUsesSharedSchema,
} from "@/lib/db/network-scope";

export const jobDetailNetworkInclude = {
  events: jobInclude.events,
  transaction: jobInclude.transaction,
  purchase: jobInclude.purchase,
  agent: jobInclude.agent,
  refundedTransaction: jobInclude.refundedTransaction,
} satisfies Prisma.JobInclude;

type JobWithDetailNetworkRelations = Prisma.JobGetPayload<{
  include: typeof jobDetailNetworkInclude;
}>;

/**
 * Hydrates a Job loaded with {@link jobDetailNetworkInclude} with its shared
 * relations and, on Mainnet only, its public share. Preprod Jobs always return
 * `share: null` until ticket 33 moves Job shares to a Network table.
 */
export async function hydrateJobDetail(
  scope: NetworkScope,
  job: JobWithDetailNetworkRelations,
) {
  const [relations, share] = await Promise.all([
    loadJobSharedRelations(scope.sharedDb, [job]),
    scope.network === "mainnet"
      ? scope.sharedDb.publicShare.findUnique({ where: { jobId: job.id } })
      : null,
  ]);
  return { ...relations[0], share };
}

/**
 * Loads full Job details by id alone (no access re-check) on the given Network
 * scope. Used for post-commit readback after an authorized mutation.
 */
export async function readJobDetailsById(scope: NetworkScope, id: string) {
  const { networkDb } = scope;
  if (networkUsesSharedSchema()) {
    return await networkDb.job.findUnique({
      where: { id },
      include: jobInclude,
    });
  }
  const job = await networkDb.job.findUnique({
    where: { id },
    include: jobDetailNetworkInclude,
  });
  if (!job) return null;
  return await hydrateJobDetail(scope, job);
}
