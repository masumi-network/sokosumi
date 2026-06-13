import { notFound } from "next/navigation";
import { TaskDetailView } from "@/app/tasks/components/task-detail-view";
import { taskService } from "@/lib/services/task.service";

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;
  const task = await taskService.getTaskById(taskId);

  if (!task) {
    return notFound();
  }

  return <TaskDetailView task={task} enableAutoSwitch />;
}
