import { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireAuthentication } from "@/lib/auth/utils";
import { getDescription, getLegal, getName } from "@/lib/db/extension/agent";
import { getAgentById, getAgents } from "@/lib/db/services/agent.service";
import { calculateAgentCreditCost } from "@/lib/db/services/credit.service";
import { getJobsByAgentId } from "@/lib/db/services/job.service";

import Footer from "./components/footer";
import Header from "./components/header";
import JobsTable from "./components/jobs-table";

interface JobPageParams {
  agentId: string;
}

export async function generateStaticParams() {
  const agents = await getAgents();
  return agents.map((agent) => ({
    agentId: String(agent.id),
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<JobPageParams>;
}): Promise<Metadata> {
  const { agentId } = await params;
  const agent = await getAgentById(agentId);
  if (!agent) {
    notFound();
  }

  return {
    title: getName(agent),
    description: getDescription(agent),
  };
}

export default async function JobLayout({
  children,
  right,
  params,
}: {
  children: React.ReactNode;
  right: React.ReactNode;
  params: Promise<JobPageParams>;
}) {
  const p = await params;
  const { agentId } = p;
  const agent = await getAgentById(agentId);
  if (!agent) {
    console.log("agent not found");
    return notFound();
  }
  const { session } = await requireAuthentication();
  const agentPrice = await calculateAgentCreditCost(agent);
  const agentJobs = await getJobsByAgentId(agentId, session.user.id);

  return (
    <div className="flex h-full flex-1 flex-col p-4 lg:p-6 xl:p-8">
      <Header agent={agent} agentPricing={agentPrice} />
      <div className="mt-6 flex flex-1 flex-col justify-center gap-4 lg:flex-row lg:overflow-hidden">
        <JobsTable jobs={agentJobs} />
        {right}
      </div>
      <Footer legal={getLegal(agent)} />
    </div>
  );
}
