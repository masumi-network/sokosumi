import { notFound } from "next/navigation";

import { getSessionOrRedirect } from "@/lib/auth/utils";
import { getAgentById, getMyJobsByAgentId } from "@/lib/services";

import JobsTable from "./components/jobs-table";

interface JobsPageProps {
  params: Promise<{ agentId: string }>;
}

export default async function JobsPage({ params }: JobsPageProps) {
  await getSessionOrRedirect();

  const { agentId } = await params;
  const agent = await getAgentById(agentId);

  if (!agent) {
    return notFound();
  }

  const agentJobs = await getMyJobsByAgentId(agentId);

  return <JobsTable jobs={agentJobs} />;
}
