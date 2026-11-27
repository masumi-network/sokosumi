import type { Prisma } from "@sokosumi/database";
import { computeJobStatus } from "@sokosumi/database/helpers";
import { jobForStatusComputeSelect } from "@sokosumi/database/types/job";
import { SokosumiJobStatus } from "@sokosumi/utils";

/**
 * What a Soko Bot reads about a Job is the status Core shows everywhere else
 * (`computeJobStatus`): a refund, a failed payment or input already given
 * decide it, not only the Agent's last event.
 */
export const SOKO_BOT_JOB_STATUS_SELECT = {
  ...jobForStatusComputeSelect,
  events: {
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 1,
    select: {
      status: true,
      input: { select: { id: true } },
      inputSchema: true,
      createdAt: true,
    },
  },
} satisfies Prisma.JobSelect;

type JobForStatus = Parameters<typeof computeJobStatus>[0] & {
  events: readonly { inputSchema: string | null }[];
};

/** The computed status, and the input schema only when input is required. */
export function sokoBotJobStatus(job: JobForStatus): {
  status: SokosumiJobStatus;
  inputSchema: string | null;
} {
  const status = computeJobStatus(job);
  return {
    status,
    inputSchema:
      status === SokosumiJobStatus.INPUT_REQUIRED
        ? (job.events[0]?.inputSchema ?? null)
        : null,
  };
}
