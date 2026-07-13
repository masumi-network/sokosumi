import { isTaskEditableStatus } from "@sokosumi/utils";

import type { TaskStatus } from "@/lib/types/core-dto";

interface TaskEditEligibilityInput {
  status: TaskStatus;
  awaitingVendorApproval?: boolean;
}

export function isTaskEditPageAllowed(task: TaskEditEligibilityInput): boolean {
  return isTaskEditableStatus(task.status) && !task.awaitingVendorApproval;
}
