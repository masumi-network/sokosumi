import { agentRepository } from "@sokosumi/database/repositories";
import { notFound } from "next/navigation";

import { JobsList } from "@/app/agents/[agentId]/jobs/components/jobs-list";
import { getSession } from "@/lib/auth/utils";
import prisma from "@/lib/db/prisma";
import { userService } from "@/lib/services";

interface JobDetailListPageProps {
  params: Promise<{ agentId: string; jobId: string }>;
}

export default async function JobDetailListPage({
  params,
}: JobDetailListPageProps) {
  const session = await getSession();
  if (!session) {
    return notFound();
  }

  const { agentId, jobId } = await params;
  const agent = await agentRepository.getAgentWithRelationsById(
    agentId,
    prisma,
  );
  if (!agent) {
    return notFound();
  }

  const agentJobs = await userService.getMyJobs(agentId);

  return (
    <JobsList
      jobs={agentJobs}
      userId={session.user.id}
      agentId={agentId}
      selectedJobId={jobId}
    />
  );
}
