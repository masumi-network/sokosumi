// Next.js will invalidate the cache when a

import { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireAuthentication } from "@/lib/auth/utils";
import { AgentDTO } from "@/lib/db/dto/AgentDTO";
import { getAgentById, getAgents } from "@/lib/db/services/agent.service";
import { getUserJobsByAgentId } from "@/lib/db/services/job.service";

import Footer from "./components/footer";
import Header from "./components/header";
import JobsTable from "./components/jobs-table";
import RightSection from "./components/right-section";

// request comes in, at most once every 1 hour (3600 seconds).
export const revalidate = 3600;

// We'll prerender only the params from `generateStaticParams` at build time.
// If a request comes in for a path that hasn't been generated,
// Next.js will server-render the page on-demand.
export const dynamicParams = true; // or false, to 404 on unknown paths

interface JobPageParams {
  agentId: string;
}

export async function generateStaticParams() {
  const agents = await getAgents();
  return agents.map((agent) => ({
    agentId: String(agent.id),
  }));
}

// generateMetadata is streamed by default

export async function generateMetadata({
  params,
}: {
  params: Promise<JobPageParams>;
}): Promise<Metadata> {
  const { agentId } = await params;
  let agent: AgentDTO | undefined = undefined;
  try {
    agent = await getAgentById(agentId);
  } catch {
    notFound();
  }

  return {
    title: agent?.name ?? "",
    description: agent?.description ?? "",
  };
}

export default async function JobPage({
  params,
}: {
  params: Promise<JobPageParams>;
}) {
  const { agentId } = await params;
  let agent: AgentDTO;
  try {
    agent = await getAgentById(agentId);
  } catch {
    return null;
  }

  const { session } = await requireAuthentication();
  const jobs = await getUserJobsByAgentId(agentId, session.user.id);

  return (
    <div className="flex h-full flex-1 flex-col p-4 lg:p-6 xl:p-8">
      <Header agent={agent} />
      <div className="mt-6 flex flex-1 flex-col justify-center gap-4 lg:flex-row lg:overflow-hidden">
        <JobsTable jobs={jobs} />
        <RightSection agent={agent} />
      </div>
      <Footer legal={agent.legal} />
    </div>
  );
}
