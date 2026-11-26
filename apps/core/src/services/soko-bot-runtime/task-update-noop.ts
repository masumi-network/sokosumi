import { seoAuditTextUnchanged } from "@/helpers/seo-task-execution";

type StoredTask = {
  name: string;
  description: string | null;
  status: string;
  projectId: string | null;
};

type TaskUpdateRequest = {
  archive?: boolean;
  name?: string;
  description?: string | null;
  status?: string;
  projectId?: string | null;
};

/**
 * True when a Soko Bot task update changes nothing, so the runtime records
 * it as already satisfied and writes nothing. A full audit's description is
 * read without its hidden `seo_audit` line, so the bot sends back the visible
 * text: that is no change, and it must not reach the frozen-request check.
 */
export function isNoopTaskUpdate(
  before: StoredTask,
  input: TaskUpdateRequest,
  unassign: boolean,
): boolean {
  return (
    !input.archive &&
    (input.name === undefined || input.name === before.name) &&
    (input.description === undefined ||
      input.description === before.description ||
      seoAuditTextUnchanged(before.description, input.description)) &&
    (input.status === undefined || input.status === before.status) &&
    (input.projectId === undefined || input.projectId === before.projectId) &&
    !unassign
  );
}
