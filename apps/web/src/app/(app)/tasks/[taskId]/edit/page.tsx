import type { Metadata } from "next";

import { ProjectScopeMarker } from "@/app/components/project-scope/project-scope-marker";
import {
  loadTaskEdit,
  TaskEditView,
} from "@/app/tasks/[taskId]/_lib/load-task-edit";

export const metadata: Metadata = {
  title: "Edit Task",
};

export default async function EditTaskPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;
  const result = await loadTaskEdit(taskId);
  return (
    <>
      {result.kind === "edit" ? (
        <ProjectScopeMarker
          projectId={result.initialValues.projectId ?? null}
        />
      ) : null}
      <TaskEditView result={result} />
    </>
  );
}
