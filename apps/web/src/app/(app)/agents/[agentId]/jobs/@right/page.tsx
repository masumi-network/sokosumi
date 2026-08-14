import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { getCachedMyJobs } from "@/app/agents/[agentId]/jobs/_lib/get-cached-my-jobs";
import { getCoreAgentById } from "@/lib/agents/core-loaders";

import JobDetailRedirect from "./components/job-detail-redirect";

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

  if (agentJobsPage.jobs.length > 0) {
    return (
      <JobDetailRedirect agentId={agentId} jobId={agentJobsPage.jobs[0].id} />
    );
  }

  return (
    <div className="grid w-full place-items-center px-4 py-10 lg:min-h-[calc(100svh-4rem)]">
      <div className="bg-muted/30 w-full max-w-4xl rounded-xl border p-8 text-center">
        <p className="text-muted-foreground text-sm">{t("noExecutedJobs")}</p>
      </div>
    </div>
  );
}
