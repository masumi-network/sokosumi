import { TaskStatus } from "@sokosumi/database";

export function isChargeableTaskStatus(
  status: TaskStatus | undefined,
): boolean {
  return status === TaskStatus.COMPLETED || status === TaskStatus.CANCELED;
}
