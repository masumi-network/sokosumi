import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import DefaultLoading from "@/components/default-loading";
import { getCoreAgentById } from "@/lib/agents/core-loaders";
import { getSession } from "@/lib/auth/auth.server";
import { agentService } from "@/lib/services";
import {
  createUnavailableCoreAgent,
  getAgentRatingStats,
} from "@/lib/types/core-dto";

import { getCachedMyJobs } from "./_lib/get-cached-my-jobs";
import { JobsHeaderContext } from "./components/jobs-header-context";
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

  const agent = coreAgent ?? createUnavailableCoreAgent(agentId);
  const ratingStats = coreAgent
    ? getAgentRatingStats(coreAgent)
    : { total: 0, average: null };
  const disabled = !coreAgent;

  const [agentJobsPage, canRate, existingRating] = await Promise.all([
    getCachedMyJobs(agentId),
    coreAgent ? agentService.canUserRateAgent(agentId) : Promise.resolve(false),
    coreAgent
      ? agentService.getUserRatingForAgent(agentId)
      : Promise.resolve(null),
  ]);

  return (
    <JobsHeaderContext
      value={{
        agent,
        ratingStats,
        canRate,
        existingRating,
        disabled,
      }}
    >
      <div className="flex w-full flex-col">
        {/*
         * Whether two panes fit is a content-width question, not a viewport
         * one: the sidebar takes 14rem (expanded) or 3.5rem (rail) out of the
         * window before this row sees any of it, so a `lg:` media query turned
         * the panes on at a width the panes did not have. The row is its own
         * query container instead, and `useJobsTwoPaneFit` measures the same
         * box for the two decisions that need JS.
         *
         * Containment starts at md because `container-type` implies
         * `contain: layout`, which would make the `md:hidden` fixed jobs header
         * position against this row instead of the viewport. Nothing inside
         * these panes may be `fixed` at md and up.
         */}
        <div
          data-jobs-panes
          className="flex w-full flex-col gap-4 md:@container/jobs-panes @4xl/jobs-panes:flex-row @4xl/jobs-panes:items-start"
        >
          <div className="w-full px-4 @4xl/jobs-panes:sticky @4xl/jobs-panes:top-16 @4xl/jobs-panes:h-[calc(100dvh-4rem)] @4xl/jobs-panes:w-72 @4xl/jobs-panes:flex-none">
            <JobsList
              key={agentId}
              jobs={agentJobsPage.jobs}
              jobsNextCursor={agentJobsPage.nextCursor}
              userId={session.user.id}
              agentId={agentId}
            />
          </div>

          <div className="h-full min-h-0 min-w-0 flex-1 @4xl/jobs-panes:hidden">
            <div className="mx-auto h-full min-h-0 w-full px-4">{children}</div>
          </div>

          <div className="hidden h-full min-h-0 min-w-0 flex-1 @4xl/jobs-panes:block">
            <div className="mx-auto h-full min-h-0 w-full px-4">{right}</div>
          </div>
        </div>
        {modal}
      </div>
    </JobsHeaderContext>
  );
}

function JobLayoutSkeleton() {
  return (
    <div className="flex flex-col lg:h-[calc(100dvh-6rem)]">
      <div className="mt-6 flex flex-1">
        <DefaultLoading className="h-full min-h-[300px] w-full flex-1 p-8" />
      </div>
    </div>
  );
}
