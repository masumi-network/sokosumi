import type { Metadata } from "next";

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
  return <TaskEditView result={result} />;
}
