import { TaskStatus } from "@sokosumi/database";

/** A Task in one of these is finished: nothing more will happen to it. */
export const SETTLED_TASK_STATUSES = [
  TaskStatus.COMPLETED,
  TaskStatus.FAILED,
  TaskStatus.CANCELED,
] as const satisfies readonly TaskStatus[];
