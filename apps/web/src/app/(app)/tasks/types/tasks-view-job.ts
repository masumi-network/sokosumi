import type { JobType, SokosumiJobStatus } from "@sokosumi/database";

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
