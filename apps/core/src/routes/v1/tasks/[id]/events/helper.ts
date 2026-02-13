import { TaskStatus } from "@sokosumi/database";

export function isCreditableTaskStatus(
  status: TaskStatus | undefined,
): boolean {
  return (
    status === TaskStatus.COMPLETED ||
    status === TaskStatus.CANCELED ||
    status === TaskStatus.CREDITS_TOPPED_UP
  );
}

export function isChargeableTaskStatus(
  status: TaskStatus | undefined,
): boolean {
  return status === TaskStatus.COMPLETED || status === TaskStatus.CANCELED;
}
