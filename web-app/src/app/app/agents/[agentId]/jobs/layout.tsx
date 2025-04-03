import { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { requireAuthentication } from "@/lib/auth/utils";
import { getDescription, getLegal, getName } from "@/lib/db/extension/agent";
import { getAgentById, getAgents } from "@/lib/db/services/agent.service";
import { getOrCreateFavoriteAgentList } from "@/lib/db/services/agentList.service";
import { calculateAgentCreditCost } from "@/lib/db/services/credit.service";
import { getJobsByAgentId } from "@/lib/db/services/job.service";

import Footer from "./@right/components/footer";
import Header from "./@right/components/header";
import JobsTable from "./@right/components/jobs-table";

interface JobLayoutParams {
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
  params: Promise<JobLayoutParams>;
  right: React.ReactNode;
  children: React.ReactNode;
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
  right,
  params,
}: {
  children: React.ReactNode;
  right: React.ReactNode;
  params: Promise<JobLayoutParams>;
}) {
  const resultingParams = await params;

  const { agentId } = resultingParams;
  const agent = await getAgentById(agentId);
  if (!agent) {
    console.log("agent not found in job layout");
    return notFound();
  }
  const { session } = await requireAuthentication();
  const agentPrice = await calculateAgentCreditCost(agent);
  const favoriteAgentList = await getOrCreateFavoriteAgentList(session.user.id);
  const headerList = await headers();
  const pathname = headerList.get("x-current-path");
  const pathnameArray = pathname?.split("/");
  let currentIds: string[] | undefined = undefined;
  if (pathnameArray?.length === 6) {
    currentIds = [pathnameArray[5]];
  }
  const agentJobs = await getJobsByAgentId(agentId, session.user.id);

  return (
    <div className="flex h-full flex-1 flex-col p-4 lg:p-6 xl:p-8">
      <Header
        agent={agent}
        agentPricing={agentPrice}
        favoriteAgentList={favoriteAgentList}
      />
      <div className="mt-6 flex flex-1 flex-col justify-center gap-4 lg:flex-row lg:overflow-hidden">
        <JobsTable jobs={agentJobs} highlightedJobIds={currentIds} />
        {right}
      </div>
      <Footer legal={getLegal(agent)} />
    </div>
  );
}
