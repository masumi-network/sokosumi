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
import prisma from "@/lib/db/prisma";
import {
  getAgentDescription,
  getAgentLegal,
  getAgentName,
} from "@/lib/helpers/agent";
import { agentService } from "@/lib/services";

import Footer from "./components/footer";
import JobBottomNavigation from "./components/job-bottom-navigation";
import { JobsHeaderProvider } from "./components/jobs-header-context";

export async function generateMetadata({
  params,
}: JobLayoutProps): Promise<Metadata> {
  const { agentId } = await params;
  const agent = await agentRepository.getAgentWithRelationsById(
    agentId,
    prisma,
  );
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
  modal: React.ReactNode;
  right: React.ReactNode;
  params: Promise<{ agentId: string }>;
}

export default async function JobLayout({
  children,
  modal,
  right,
  params,
}: JobLayoutProps) {
  return (
    <Suspense fallback={<JobLayoutSkeleton />}>
      <JobLayoutInner modal={modal} right={right} params={params}>
        {children}
      </JobLayoutInner>
    </Suspense>
  );
}

async function JobLayoutInner({
  right,
  modal,
  params,
  children,
}: JobLayoutProps) {
  const { agentId } = await params;
  const agent = await agentRepository.getAgentWithRelationsById(
    agentId,
    prisma,
  );
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
    jobRepository.getAverageExecutionDurationByAgentId(agentId, prisma),
    authContext?.userId
      ? agentService.canUserRateAgent(authContext.userId, agentId)
      : Promise.resolve(false),
    authContext?.userId
      ? agentRatingRepository.getUserRatingForAgent(
          authContext.userId,
          agentId,
          prisma,
        )
      : Promise.resolve(null),
  ]);

  return (
    <CreateJobModalContextProvider
      agentsWithPrice={[agentWithCreditsPrice]}
      averageExecutionDuration={averageExecutionDuration}
    >
      <JobsHeaderProvider
        value={{
          agent: agentWithCreditsPrice,
          favoriteAgents,
          ratingStats,
          canRate,
          existingRating,
          disabled: !availableAgent,
        }}
      >
        <div className="flex w-full flex-col">
          <div className="flex w-full flex-col gap-4 lg:flex-row lg:items-start">
            <div className="w-full px-4 lg:sticky lg:top-16 lg:h-[calc(100svh-64px)] lg:w-72 lg:flex-none">
              {children}
            </div>

            <div className="hidden min-w-0 flex-1 lg:block lg:h-[calc(100svh-64px)]">
              <div className="mx-auto h-full w-full px-4">{right}</div>
            </div>
          </div>
          {modal}
          <JobBottomNavigation
            agent={agentWithCreditsPrice}
            favoriteAgents={favoriteAgents}
            disabled={!availableAgent}
          />
          <Footer legal={getAgentLegal(agent)} />
          {/* Create Job Modal */}
          {!!availableAgent && <CreateJobModal />}
        </div>
      </JobsHeaderProvider>
    </CreateJobModalContextProvider>
  );
}

function JobLayoutSkeleton() {
  return (
    <div className="flex flex-col lg:h-[calc(100svh-96px)]">
      <div className="mt-6 flex flex-1">
        <DefaultLoading className="h-full min-h-[300px] w-full flex-1 p-8" />
      </div>
    </div>
  );
}
