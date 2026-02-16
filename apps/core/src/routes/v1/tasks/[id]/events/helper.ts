import { TaskStatus } from "@sokosumi/database";

export function isCreditableTaskStatus(
  status: TaskStatus | undefined,
): boolean {
  return (
    status === TaskStatus.COMPLETED ||
    status === TaskStatus.CANCELED ||
    status === TaskStatus.OUT_OF_CREDITS
  );
}
