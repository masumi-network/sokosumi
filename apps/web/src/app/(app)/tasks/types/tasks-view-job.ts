import type { JobType } from "@sokosumi/utils";
import { SokosumiJobStatus } from "@sokosumi/utils";

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
