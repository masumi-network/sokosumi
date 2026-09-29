import {
  loadTaskEdit,
  TaskEditView,
} from "@/app/tasks/[taskId]/_lib/load-task-edit";

export default async function TaskEditModalPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;
  const result = await loadTaskEdit(taskId);
  return <TaskEditView result={result} />;
}
