import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import {
  CreateJobModal,
  CreateJobModalContextProvider,
} from "@/components/create-job-modal";
import DefaultLoading from "@/components/default-loading";
import {
  createUnavailableAgentWithCreditsPrice,
  mapCoreAgentMetricsToRatingStats,
  mapCoreAgentToAgentWithCreditsPrice,
} from "@/lib/agents/core-dto-mappers";
import { getCoreAgentById } from "@/lib/agents/core-loaders";
import { getSession } from "@/lib/auth/auth.server";
import { getProjectFilterOptions } from "@/lib/helpers/project-filter-options";
import { agentService } from "@/lib/services";

import { getCachedMyJobs } from "./_lib/get-cached-my-jobs";
import JobBottomNavigation from "./components/job-bottom-navigation";
import { JobsHeaderProvider } from "./components/jobs-header-context";
import { JobsList } from "./components/jobs-list";

export async function generateMetadata({
  params,
}: JobLayoutProps): Promise<Metadata> {
  const { agentId } = await params;
  const agent = await getCoreAgentById(agentId);

  return {
    title: agent?.name ?? agentId,
    description: agent?.description ?? undefined,
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
  const session = await getSession();
  if (!session) {
    return notFound();
  }

  const { agentId } = await params;
  const coreAgent = await getCoreAgentById(agentId);

  const agentWithCreditsPrice = coreAgent
    ? mapCoreAgentToAgentWithCreditsPrice(coreAgent)
    : createUnavailableAgentWithCreditsPrice(agentId);
  const ratingStats = coreAgent
    ? mapCoreAgentMetricsToRatingStats(coreAgent)
    : { totalRatings: 0, averageRating: 0 };
  const averageExecutionDuration =
    coreAgent?.metrics.executions.averageTime ?? null;
  const disabled = !coreAgent;

  const [agentJobs, canRate, existingRating, projectOptions] =
    await Promise.all([
      getCachedMyJobs(agentId),
      coreAgent
        ? agentService.canUserRateAgent(agentId)
        : Promise.resolve(false),
      coreAgent
        ? agentService.getUserRatingForAgent(agentId)
        : Promise.resolve(null),
      getProjectFilterOptions(),
    ]);

  return (
    <CreateJobModalContextProvider
      agentsWithPrice={[agentWithCreditsPrice]}
      averageExecutionDuration={averageExecutionDuration}
      projectOptions={projectOptions}
    >
      <JobsHeaderProvider
        value={{
          agent: agentWithCreditsPrice,
          ratingStats,
          canRate,
          existingRating,
          disabled,
        }}
      >
        <div className="flex w-full flex-col">
          <div className="flex w-full flex-col gap-4 lg:flex-row lg:items-start">
            <div className="w-full px-4 lg:sticky lg:top-16 lg:h-[calc(100svh-64px)] lg:w-72 lg:flex-none">
              <JobsList
                jobs={agentJobs}
                userId={session.user.id}
                agentId={agentId}
              />
            </div>

            <div className="h-full min-h-0 min-w-0 flex-1 lg:hidden">
              <div className="mx-auto h-full min-h-0 w-full px-4">
                {children}
              </div>
            </div>

            <div className="hidden h-full min-h-0 min-w-0 flex-1 lg:block">
              <div className="mx-auto h-full min-h-0 w-full px-4">{right}</div>
            </div>
          </div>
          {modal}
          <JobBottomNavigation
            agent={agentWithCreditsPrice}
            disabled={disabled}
          />
          {/* Create Job Modal */}
          {!disabled && <CreateJobModal />}
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
