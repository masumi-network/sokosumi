import { SokosumiJobStatus } from "@/lib/clients/generated/core";
import type { JobType } from "@/lib/types/core-dto";

/** Tasks “Jobs” tab row view model — trimmed Core job fields plus coworker join. */
export interface TasksViewJob {
  id: string;
  agentId: string;
  name: string | null;
  createdAt: string;
  completedAt: string | null;
  status: SokosumiJobStatus;
  jobType: JobType;
  coworker: {
    name: string | null;
    image: string | null;
  } | null;
}
