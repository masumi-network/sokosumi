import { SokosumiJobStatus } from "@sokosumi/utils";
import type { JobType } from "@/lib/types/core-dto";

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
