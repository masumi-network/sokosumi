import { TaskStatus } from "@sokosumi/database";

export function isTaskStatusCreditable(status: TaskStatus): boolean {
  return (
    status === TaskStatus.COMPLETED ||
    status === TaskStatus.CANCELED ||
    status === TaskStatus.OUT_OF_CREDITS
  );
}
