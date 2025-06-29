import { notFound } from "next/navigation";

import { retrieveAgentWithRelationsById } from "@/lib/db/repositories";
import { getMyJobsByAgentId } from "@/lib/services";

import JobsTable from "./components/jobs-table";

interface JobsPageProps {
  params: Promise<{ agentId: string }>;
}

export default async function JobsPage({ params }: JobsPageProps) {
  const { agentId } = await params;
  const agent = await retrieveAgentWithRelationsById(agentId);
  if (!agent) {
    console.warn("agent not found in job layout");
    return notFound();
  }

  const agentJobs = await getMyJobsByAgentId(agentId);

  return <JobsTable jobs={agentJobs} />;
}
