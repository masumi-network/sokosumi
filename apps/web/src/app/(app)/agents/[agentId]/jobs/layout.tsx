import {
  agentRatingRepository,
  agentRepository,
  jobRepository,
} from "@sokosumi/database/repositories";
import { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import {
  CreateJobModal,
  CreateJobModalContextProvider,
} from "@/components/create-job-modal";
import DefaultLoading from "@/components/default-loading";
import { getAuthContext } from "@/lib/auth/utils";
import {
  getAgentDescription,
  getAgentLegal,
  getAgentName,
} from "@/lib/helpers/agent";
import { agentService } from "@/lib/services";

import Footer from "./components/footer";
import Header, { HeaderSkeleton } from "./components/header";
import JobBottomNavigation from "./components/job-bottom-navigation";

export async function generateMetadata({
  params,
}: JobLayoutProps): Promise<Metadata> {
  const { agentId } = await params;
  const agent = await agentRepository.getAgentWithRelationsById(agentId);
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
  const agent = await agentRepository.getAgentWithRelationsById(agentId);
  if (!agent) {
    return notFound();
  }

  const authContext = await getAuthContext();

  const [
    agentWithCreditsPrice,
    favoriteAgents,
    availableAgent,
    ratingStats,
    averageExecutionDuration,
    canRate,
    existingRating,
  ] = await Promise.all([
    agentService.getAgentCreditsPrice(agent),
    agentService.getFavoriteAgents(),
    agentService.getAvailableAgentById(agentId),
    agentService.getAgentRatingStats(agentId),
    jobRepository.getAverageExecutionDurationByAgentId(agentId),
    authContext?.userId
      ? agentService.canUserRateAgent(authContext.userId, agentId)
      : Promise.resolve(false),
    authContext?.userId
      ? agentRatingRepository.getUserRatingForAgent(authContext.userId, agentId)
      : Promise.resolve(null),
  ]);

  return (
    <CreateJobModalContextProvider
      agentsWithPrice={[agentWithCreditsPrice]}
      averageExecutionDuration={averageExecutionDuration}
    >
      <div className="flex w-full flex-col lg:h-[calc(100svh-96px)]">
        <Header
          agent={agentWithCreditsPrice}
          favoriteAgents={favoriteAgents}
          ratingStats={ratingStats}
          canRate={canRate}
          existingRating={existingRating}
          disabled={!availableAgent}
        />
        <div className="mt-6 flex flex-1 flex-col justify-center gap-4 lg:flex-row lg:overflow-hidden">
          {children}
          {right}
        </div>
        <JobBottomNavigation
          agent={agentWithCreditsPrice}
          favoriteAgents={favoriteAgents}
          disabled={!availableAgent}
        />
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
        <DefaultLoading className="bg-muted/50 h-full min-h-[300px] w-full flex-1 rounded-xl border p-8" />
      </div>
    </div>
  );
}
