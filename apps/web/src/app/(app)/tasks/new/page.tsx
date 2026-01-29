import { getTranslations } from "next-intl/server";

import { agentService } from "@/lib/services";
import { orchestratorService } from "@/lib/services/orchestrator.service";

import { NewTaskForm } from "./components/new-task-form";

export const metadata = {
  title: "New Task",
};

export default async function NewTaskPage() {
  const t = await getTranslations("App.Tasks.NewTask");
  const [agents, orchestrators] = await Promise.all([
    agentService.getAvailableAgents(),
    orchestratorService.listOrchestrators(),
  ]);
  const orchestratorOptions = orchestrators.map((orchestrator) => ({
    id: orchestrator.id,
    name: orchestrator.name,
    image: orchestrator.image ?? "",
  }));

  return (
    <div className="w-full max-w-3xl space-y-6 px-2">
      <NewTaskForm
        labels={{
          pageTitle: t("title"),
          details: t("details"),
          detailsDescription: t("detailsDescription"),
          descriptionPlaceholder: t("descriptionPlaceholder"),
          orchestrator: t("orchestrator"),
          orchestratorDescription: t("orchestratorDescription"),
          status: t("status"),
          statusDescription: t("statusDescription"),
          statusDraft: t("statusDraft"),
          statusReady: t("statusReady"),
          back: t("back"),
          uploadFile: t("uploadFile"),
          saveDraft: t("saveDraft"),
          cancel: t("cancel"),
          ctrl: t("ctrl"),
        }}
        orchestratorOptions={orchestratorOptions}
        agents={agents}
      />
    </div>
  );
}
