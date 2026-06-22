import { TaskStatus } from "@sokosumi/utils";

type TaskStatusLabelKey = keyof typeof TASK_STATUS_LABEL_KEYS;

const TASK_STATUS_LABEL_KEYS = {
  DRAFT: true,
  QUEUED: true,
  READY: true,
  INPUT_REQUIRED: true,
  APPROVAL_REQUIRED: true,
  AUTHENTICATION_REQUIRED: true,
  OUT_OF_CREDITS: true,
  CREDITS_TOPPED_UP: true,
  RUNNING: true,
  AWAITING_EXTERNAL: true,
  COMPLETED: true,
  FAILED: true,
  CANCEL_REQUESTED: true,
  CANCELED: true,
} as const satisfies Record<TaskStatus, true>;

export function buildTaskStatusLabels(
  translate: (key: TaskStatusLabelKey) => string,
): Record<TaskStatus, string> {
  return {
    [TaskStatus.DRAFT]: translate("DRAFT"),
    [TaskStatus.QUEUED]: translate("QUEUED"),
    [TaskStatus.READY]: translate("READY"),
    [TaskStatus.INPUT_REQUIRED]: translate("INPUT_REQUIRED"),
    [TaskStatus.APPROVAL_REQUIRED]: translate("APPROVAL_REQUIRED"),
    [TaskStatus.AUTHENTICATION_REQUIRED]: translate("AUTHENTICATION_REQUIRED"),
    [TaskStatus.OUT_OF_CREDITS]: translate("OUT_OF_CREDITS"),
    [TaskStatus.CREDITS_TOPPED_UP]: translate("CREDITS_TOPPED_UP"),
    [TaskStatus.RUNNING]: translate("RUNNING"),
    [TaskStatus.AWAITING_EXTERNAL]: translate("AWAITING_EXTERNAL"),
    [TaskStatus.COMPLETED]: translate("COMPLETED"),
    [TaskStatus.FAILED]: translate("FAILED"),
    [TaskStatus.CANCEL_REQUESTED]: translate("CANCEL_REQUESTED"),
    [TaskStatus.CANCELED]: translate("CANCELED"),
  };
}
