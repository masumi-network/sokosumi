import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { CreateJobModalTrigger } from "@/app/agents/[agentId]/jobs/components/create-job-modal";
import { requireAuthentication } from "@/lib/auth/utils";
import { getAgentById, getJobsByAgentIdAndUserId } from "@/lib/db";
import { getAgentCreditsPrice, getAgentInputSchema } from "@/lib/services";

import JobDetailRedirector from "./components/job-detail-redirector";

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

  const agent = await getAgentById(agentId);
  if (!agent) {
    console.warn("agent not found in right page");
    notFound();
  }

  const agentCreditsPrice = await getAgentCreditsPrice(agent);
  const agentInputSchemaPromise = getAgentInputSchema(agentId);

  const { session } = await requireAuthentication();
  const agentJobs = await getJobsByAgentIdAndUserId(agentId, session.user.id);

  if (agentJobs.length > 0) {
    return <JobDetailRedirector agentId={agentId} jobId={agentJobs[0].id} />;
  }

  return (
    <div className="bg-muted/50 flex h-full w-full flex-1 items-center justify-center rounded-xl border-none">
      <div className="flex flex-col gap-4">
        <p>{t("noExecutedJobs")}</p>
        <CreateJobModalTrigger
          agent={agent}
          agentCreditsPrice={agentCreditsPrice}
          inputSchemaPromise={agentInputSchemaPromise}
        />
      </div>
    </div>
  );
}
