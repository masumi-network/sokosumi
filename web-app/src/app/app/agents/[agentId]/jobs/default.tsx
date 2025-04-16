import { notFound } from "next/navigation";

import { requireAuthentication } from "@/lib/auth/utils";
import { getAgentById, getJobsByAgentId } from "@/lib/db";

import JobsTable from "./components/jobs-table";

interface JobDefaultPageProps {
  params: Promise<{ agentId: string }>;
}

export default async function JobDefaultPage({ params }: JobDefaultPageProps) {
  const { agentId } = await params;
  const agent = await getAgentById(agentId);
  if (!agent) {
    console.warn("agent not found in job layout");
    return notFound();
  }

  const { session } = await requireAuthentication();
  const agentJobs = await getJobsByAgentId(agentId, session.user.id);

  return <JobsTable jobs={agentJobs} />;
}
