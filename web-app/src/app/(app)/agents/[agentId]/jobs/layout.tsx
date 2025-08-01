import { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import {
  CreateJobModal,
  CreateJobModalContextProvider,
} from "@/components/create-job-modal";
import DefaultLoading from "@/components/default-loading";
import { getSessionOrRedirect } from "@/lib/auth/utils";
import { getAgentDescription, getAgentLegal, getAgentName } from "@/lib/db";
import { jobRepository } from "@/lib/db/repositories";
import {
  getAgentById,
  getAgentCreditsPrice,
  getAvailableAgentById,
  getFavoriteAgents,
} from "@/lib/services";

import Footer from "./components/footer";
import Header, { HeaderSkeleton } from "./components/header";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ agentId: string }>;
}): Promise<Metadata> {
  const { agentId } = await params;
  const agent = await getAgentById(agentId);
  if (!agent) {
    notFound();
  }

  return {
    title: getAgentName(agent),
    description: getAgentDescription(agent),
  };
}

interface JobLayoutProps {
  children: React.ReactNode;
  right: React.ReactNode;
  params: Promise<{ agentId: string }>;
}

export default async function JobLayout({
  children,
  right,
  params,
}: JobLayoutProps) {
  await getSessionOrRedirect();

  return (
    <Suspense fallback={<JobLayoutSkeleton />}>
      <JobLayoutInner right={right} params={params}>
        {children}
      </JobLayoutInner>
    </Suspense>
  );
}

async function JobLayoutInner({ right, params, children }: JobLayoutProps) {
  const { agentId } = await params;
  const agent = await getAgentById(agentId);
  if (!agent) {
    return notFound();
  }

  const agentCreditsPrice = await getAgentCreditsPrice(agent);
  const favoriteAgents = await getFavoriteAgents();
  const [executedJobsCount, averageExecutionDuration] = await Promise.all([
    jobRepository.getExecutedJobsCountByAgentId(agentId),
    jobRepository.getAverageExecutionDurationByAgentId(agentId),
  ]);
  const availableAgent = await getAvailableAgentById(agentId);

  return (
    <CreateJobModalContextProvider
      agentsWithPrice={[{ agent, creditsPrice: agentCreditsPrice }]}
      averageExecutionDuration={averageExecutionDuration}
    >
      <div className="flex flex-col lg:h-[calc(100svh-96px)]">
        <Header
          agent={agent}
          agentCreditsPrice={agentCreditsPrice}
          executedJobsCount={executedJobsCount}
          averageExecutionDuration={averageExecutionDuration}
          favoriteAgents={favoriteAgents}
          disabled={!availableAgent}
        />
        <div className="mt-6 flex flex-1 flex-col justify-center gap-4 lg:flex-row lg:overflow-hidden">
          {children}
          {right}
        </div>
        <Footer legal={getAgentLegal(agent)} />
        {/* Create Job Modal */}
        {!!availableAgent && <CreateJobModal />}
      </div>
    </CreateJobModalContextProvider>
  );
}

function JobLayoutSkeleton() {
  return (
    <div className="flex flex-col lg:h-[calc(100svh-96px)]">
      <HeaderSkeleton />
      <div className="mt-6 flex flex-1">
        <DefaultLoading className="bg-muted/50 h-full min-h-[300px] w-full flex-1 rounded-xl border-none p-8" />
      </div>
    </div>
  );
}
