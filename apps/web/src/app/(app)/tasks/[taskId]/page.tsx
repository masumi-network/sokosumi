import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { TaskActivitySection } from "@/app/tasks/components/task-activity";
import { TaskDescription } from "@/app/tasks/components/task-description";
import { TaskDetailHeader } from "@/app/tasks/components/task-detail-header";
import { TaskMetadata } from "@/app/tasks/components/task-metadata";
import { getTaskById } from "@/app/tasks/data/mock-data";

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;
  const task = getTaskById(taskId);

  if (!task) {
    return notFound();
  }

  const t = await getTranslations("App.Tasks.Detail");
  const tCard = await getTranslations("App.Tasks.Card");

  return (
    <div className="w-full space-y-6 px-2">
      <TaskDetailHeader
        task={task}
        labels={{
          back: t("back"),
          budget: tCard("budget"),
          actions: {
            edit: t("actions.edit"),
            delete: t("actions.delete"),
          },
        }}
      />

      <TaskMetadata
        task={task}
        labels={{
          status: t("status"),
          assignee: t("assignee"),
          tags: t("tags"),
          dueDate: t("dueDate"),
          budget: tCard("budget"),
          orchestrator: t("orchestrator"),
        }}
      />

      <TaskDescription
        title={t("description")}
        description={task.description}
      />

      <TaskActivitySection
        title={t("activity")}
        placeholder={t("commentPlaceholder")}
        attachLabel={t("attach")}
        submitLabel={t("submit")}
        activities={task.activities}
      />
    </div>
  );
}
