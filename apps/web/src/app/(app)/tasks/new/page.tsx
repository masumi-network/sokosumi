import { getTranslations } from "next-intl/server";

import { TaskForm } from "@/app/tasks/components/task-form";
import { coworkerService } from "@/lib/services/coworker.service";

export const metadata = {
  title: "New Task",
};

export default async function NewTaskPage() {
  const t = await getTranslations("App.Tasks.NewTask");
  const coworkers = await coworkerService.listCoworkers();
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

  return (
    <div className="w-full max-w-3xl space-y-6 px-2">
      <TaskForm
        mode="create"
        labels={{
          pageTitle: t("title"),
          details: t("details"),
          detailsDescription: t("detailsDescription"),
          name: t("name"),
          namePlaceholder: t("namePlaceholder"),
          descriptionPlaceholder: t("descriptionPlaceholder"),
          coworker: t("coworker"),
          coworkerDescription: t("coworkerDescription"),
          status: t("status"),
          statusDescription: t("statusDescription"),
          statusDraft: t("statusDraft"),
          statusReady: t("statusReady"),
          back: t("back"),
          uploadFile: t("uploadFile"),
          submit: t("saveDraft"),
          cancel: t("cancel"),
          ctrl: t("ctrl"),
        }}
        coworkerOptions={coworkerOptions}
      />
    </div>
  );
}
