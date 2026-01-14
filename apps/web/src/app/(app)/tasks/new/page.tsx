import { getTranslations } from "next-intl/server";

import { agentService } from "@/lib/services";

import { NewTaskForm } from "./components/new-task-form";

export const metadata = {
  title: "New Task",
};

export default async function NewTaskPage() {
  const t = await getTranslations("App.Tasks.NewTask");
  const agents = await agentService.getAvailableAgents();

  return (
    <div className="w-full space-y-6 px-2">
      <NewTaskForm
        labels={{
          pageTitle: t("title"),
          details: t("details"),
          detailsDescription: t("detailsDescription"),
          descriptionPlaceholder: t("descriptionPlaceholder"),
          orchestrator: t("orchestrator"),
          orchestratorDescription: t("orchestratorDescription"),
          tag: t("tag"),
          uploadFile: t("uploadFile"),
          recentlyViewedFiles: t("recentlyViewedFiles"),
          saveDraft: t("saveDraft"),
          cancel: t("cancel"),
        }}
        orchestratorOptions={[
          {
            id: "claude",
            name: "Claude",
            image:
              "https://upload.wikimedia.org/wikipedia/commons/6/6d/Anthropic_logo.svg",
          },
          {
            id: "gpt-4-1",
            name: "GPT-4.1",
            image:
              "https://upload.wikimedia.org/wikipedia/commons/4/4d/OpenAI_Logo.svg",
          },
          {
            id: "gemini",
            name: "Gemini",
            image:
              "https://upload.wikimedia.org/wikipedia/commons/2/2f/Google_Gemini_logo.svg",
          },
          {
            id: "llama-3-2",
            name: "Llama 3.2",
            image:
              "https://upload.wikimedia.org/wikipedia/commons/3/3f/Meta_LLaMA_logo.svg",
          },
        ]}
        tagOptions={[
          "GWI Spark",
          "Statista Single Answer",
          "Basic News Search",
          "Instagram Page Analysis",
        ]}
        recentFiles={["Proposal.pdf", "data.csv"]}
        agents={agents}
      />
    </div>
  );
}
