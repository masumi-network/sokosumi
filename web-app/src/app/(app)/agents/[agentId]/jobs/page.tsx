import { notFound } from "next/navigation";

import { getSessionOrRedirect } from "@/lib/auth/utils";
import { agentRepository } from "@/lib/db/repositories";
import { getMyJobsByAgentId } from "@/lib/services";

import JobsTable from "./components/jobs-table";

interface JobsPageProps {
  params: Promise<{ agentId: string }>;
}

export default async function JobsPage({ params }: JobsPageProps) {
  const session = await getSessionOrRedirect();

  const { agentId } = await params;
  const agent = await agentRepository.getAgentWithRelationsById(agentId);

  if (!agent) {
    return notFound();
  }

  const agentJobs = await getMyJobsByAgentId(agentId);

  return <JobsTable jobs={agentJobs} userId={session.user.id} />;
}
