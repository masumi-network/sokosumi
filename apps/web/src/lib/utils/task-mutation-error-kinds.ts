import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

/**
 * The stable Core error kinds a Task mutation reports back to its caller as a
 * result instead of throwing. They are a Core-contract concept, so they live
 * outside the server action module that returns them.
 */
export const TASK_MUTATION_ERROR_KINDS = [
  CORE_API_ERROR_KINDS.CALENDAR_CLIENT_UPGRADE_REQUIRED,
  CORE_API_ERROR_KINDS.STATUS_NOT_SELECTABLE,
] as const;

export type TaskMutationErrorKind = (typeof TASK_MUTATION_ERROR_KINDS)[number];
