import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { getCachedMyJobs } from "@/app/agents/[agentId]/jobs/_lib/get-cached-my-jobs";
import { CreateJobModalTrigger } from "@/components/create-job-modal";
import { getCoreAgentById } from "@/lib/agents/core-loaders";

interface RightSectionPageParams {
  agentId: string;
}

export default async function RightSectionPage({
  params,
}: {
  params: Promise<RightSectionPageParams>;
}) {
  const t = await getTranslations("App.Agents.Jobs.RightSection");

  const { agentId } = await params;

  const [agent, agentJobsPage] = await Promise.all([
    getCoreAgentById(agentId),
    getCachedMyJobs(agentId),
  ]);
  if (!agent && agentJobsPage.jobs.length === 0) {
    notFound();
  }

  // List is the stable surface. Job detail lives at /jobs/{jobId}; do not
  // auto-navigate away from /agents/{id}/jobs when jobs exist.
  if (agentJobsPage.jobs.length > 0) {
    return (
      <div className="grid w-full place-items-center px-4 py-10 lg:min-h-[calc(100svh-4rem)]">
        <div className="bg-muted/30 w-full max-w-4xl rounded-xl border p-8 text-center">
          <p className="text-muted-foreground text-sm">{t("selectJob")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid w-full place-items-center px-4 py-10 lg:min-h-[calc(100svh-4rem)]">
      <div className="bg-muted/30 w-full max-w-4xl rounded-xl border p-8 text-center">
        <p className="text-muted-foreground text-sm">{t("noExecutedJobs")}</p>
        <div className="mt-5 flex justify-center">
          <CreateJobModalTrigger agentId={agentId} disabled={!agent} />
        </div>
      </div>
    </div>
  );
}
