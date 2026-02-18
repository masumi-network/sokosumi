import { getTranslations } from "next-intl/server";

import { TaskForm } from "@/app/tasks/components/task-form";
import { getCoworkerOptions } from "@/app/tasks/utils/coworker-options";
import { coworkerService } from "@/lib/services/coworker.service";

export const metadata = {
  title: "New Task",
};

export default async function NewTaskPage() {
  const t = await getTranslations("App.Tasks.NewTask");
  const coworkers = await coworkerService.listCoworkers();
  const coworkerOptions = getCoworkerOptions(coworkers);

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-4xl space-y-6 px-4">
        <TaskForm
          mode="create"
          labels={{
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
            uploadFileError: t("uploadFileError"),
            removeAttachment: t("removeAttachment"),
            submit: t("saveDraft"),
            saveAsDraft: t("saveAsDraft"),
            createTask: t("createTask"),
            cancel: t("cancel"),
            ctrl: t("ctrl"),
          }}
          coworkerOptions={coworkerOptions}
        />
      </div>
    </div>
  );
}
