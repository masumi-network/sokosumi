import type {
  ProjectSeoWorkspace,
  RecordProjectSeoPageChangeRequest,
} from "@sokosumi/core-client";
import { formText } from "./seo-form-model";

/** datetime-local uses the device's civil time. Core receives an explicit UTC instant. */
export function seoPageChangeBody(
  form: FormData,
  workspace: ProjectSeoWorkspace,
): Omit<RecordProjectSeoPageChangeRequest, "idempotencyKey"> {
  const occurredAt = new Date(formText(form, "occurredAt"));
  if (!Number.isFinite(occurredAt.getTime()) || !workspace.scope.pageIds.length)
    throw new Error("Invalid page change");
  return {
    pageIds: workspace.scope.pageIds,
    occurredAt,
    title: formText(form, "title"),
    note: formText(form, "note"),
  };
}
