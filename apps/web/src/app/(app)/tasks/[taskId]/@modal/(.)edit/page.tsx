import { TaskStatus } from "@sokosumi/database";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { TaskEditModal } from "@/app/tasks/components/task-edit-modal";
import { coworkerService } from "@/lib/services/coworker.service";
import { taskService } from "@/lib/services/task.service";

export default async function TaskEditModalPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;
  const [taskResult, coworkers] = await Promise.all([
    taskService.getTaskById(taskId),
    coworkerService.listCoworkers(),
  ]);

  if (!taskResult) {
    return notFound();
  }

  if (
    taskResult.status !== TaskStatus.DRAFT &&
    taskResult.status !== TaskStatus.READY
  ) {
    redirect(`/tasks/${taskId}`);
  }

  const coworkerDefaults: Record<
    string,
    { image: string; description: string }
  > = {
    soko: {
      image: "/images/kanji/sokosumi-logo-kanji-black.svg",
      description:
        "Your default AI coworker. Great for general tasks, research, and getting things done.",
    },
    hannah: {
      image: "/images/coworkers/hannah.png",
      description:
        "Creative strategist and communications expert. Ideal for content, marketing, and outreach.",
    },
  };
  const coworkerOptions = coworkers.map((coworker) => {
    const slug = coworker.slug?.toLowerCase() ?? coworker.name.toLowerCase();
    const defaults = coworkerDefaults[slug];
    return {
      id: coworker.id,
      name: coworker.name,
      image: coworker.image || defaults?.image || "",
      description: coworker.description || defaults?.description || undefined,
    };
  });

  const [tEdit, tActions] = await Promise.all([
    getTranslations("App.Tasks.EditTask"),
    getTranslations("App.Tasks.Detail.actions"),
  ]);

  return (
    <TaskEditModal
      taskId={taskId}
      labels={{
        pageTitle: tEdit("title"),
        details: tEdit("details"),
        detailsDescription: tEdit("detailsDescription"),
        name: tEdit("name"),
        namePlaceholder: tEdit("namePlaceholder"),
        descriptionPlaceholder: tEdit("descriptionPlaceholder"),
        coworker: tEdit("coworker"),
        coworkerDescription: tEdit("coworkerDescription"),
        status: tEdit("status"),
        statusDescription: tEdit("statusDescription"),
        statusDraft: tEdit("statusDraft"),
        statusReady: tEdit("statusReady"),
        markAsReady: tActions("markAsReady"),
        revertToDraft: tActions("revertToDraft"),
        back: tEdit("back"),
        uploadFile: tEdit("uploadFile"),
        submit: tEdit("save"),
        cancel: tEdit("cancel"),
        ctrl: tEdit("ctrl"),
      }}
      coworkerOptions={coworkerOptions}
      initialValues={{
        name: taskResult.name,
        description: taskResult.description ?? "",
        coworkerId: taskResult.coworkerId ?? "",
        status: taskResult.status,
      }}
    />
  );
}
