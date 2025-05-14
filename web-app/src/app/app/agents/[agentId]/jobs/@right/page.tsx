import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { CreateJobModalTrigger } from "@/components/create-job-modal";
import { requireAuthentication } from "@/lib/auth/utils";
import { getAgentById, getJobsByAgentIdAndUserId } from "@/lib/db";

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

  const agent = await getAgentById(agentId);
  if (!agent) {
    console.warn("agent not found in right page");
    notFound();
  }

  const { session } = await requireAuthentication();
  const agentJobs = await getJobsByAgentIdAndUserId(agentId, session.user.id);

  if (agentJobs.length > 0) {
    return <JobDetailRedirect agentId={agentId} jobId={agentJobs[0].id} />;
  }

  return (
    <div className="bg-muted/50 flex h-full w-full flex-1 items-center justify-center rounded-xl border-none">
      <div className="flex flex-col gap-4">
        <p>{t("noExecutedJobs")}</p>
        <CreateJobModalTrigger />
      </div>
    </div>
  );
}
