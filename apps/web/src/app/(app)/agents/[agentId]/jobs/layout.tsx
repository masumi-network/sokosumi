import type { Metadata } from "next";
import { notFound, unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import {
  JobsListHeaderSkeleton,
  JobsPanesSkeleton,
} from "@/app/agents/[agentId]/jobs/components/jobs-loading";
import {
  APP_MAIN_MOBILE_PT_CLASS,
  APP_SHELL_BELOW_HEADER_MIN_HEIGHT_CLASS,
} from "@/app/components/app-shell-safe-area";
import { MarkAgentUnavailable } from "@/app/components/unavailable-agent.client";
import { getCoreAgentById } from "@/lib/agents/core-loaders";
import { getSession } from "@/lib/auth/auth.server";
import { agentService } from "@/lib/services/agent.service";
import { createUnavailableCoreAgent } from "@/lib/types/core-dto";
import { cn } from "@/lib/utils";

import AgentFullbleedEffect from "../components/agent-fullbleed-effect";

import { getCachedMyJobs } from "./_lib/get-cached-my-jobs";
import { JobsHeaderContext } from "./components/jobs-header-context";
import { JobsList } from "./components/jobs-list";
import { JobsListHeader } from "./components/jobs-list-header";

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
  // Full-bleed (no main padding, visible overflow) so the panes can stick.
  // Only the jobs screens need it; the agent profile keeps the app gutter.
  return (
    <div
      data-agent-fullbleed
      className={cn(
        "flex flex-1 flex-col",
        APP_SHELL_BELOW_HEADER_MIN_HEIGHT_CLASS,
        APP_MAIN_MOBILE_PT_CLASS,
        "md:pt-0",
      )}
    >
      <AgentFullbleedEffect />
      <Suspense
        fallback={
          <JobsPanesSkeleton
            header={
              <Suspense fallback={<JobsListHeaderSkeleton />}>
                <LoadingJobsListHeader params={params} />
              </Suspense>
            }
          />
        }
      >
        <JobLayoutInner modal={modal} right={right} params={params}>
          {children}
        </JobLayoutInner>
      </Suspense>
    </div>
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
         * the panes on at a width the panes did not have.
         *
         * The outer box is the named query container; the inner flex queries
         * it. An element cannot query its own containment context, so
         * `@4xl/jobs-panes:flex-row` on the `@container` node would never
         * match. `useJobsTwoPaneFit` measures the same outer box.
         *
         * Containment starts at md because `container-type` implies
         * `contain: layout`, which would make the `md:hidden` fixed jobs header
         * position against this row instead of the viewport. Nothing inside
         * these panes may be `fixed` at md and up.
         */}
        <div data-jobs-panes className="w-full md:@container/jobs-panes">
          <div className="flex w-full flex-col gap-4 @4xl/jobs-panes:flex-row @4xl/jobs-panes:items-start">
            <div className="w-full px-4 @4xl/jobs-panes:sticky @4xl/jobs-panes:top-16 @4xl/jobs-panes:h-[calc(100dvh-4rem)] @4xl/jobs-panes:w-72 @4xl/jobs-panes:flex-none">
              <JobsList
                key={agentId}
                jobs={agentJobsPage.jobs}
                jobsNextCursor={agentJobsPage.nextCursor}
                userId={session.user.id}
                agentId={agentId}
                header={
                  <JobsListHeader
                    agent={agent}
                    total={agentJobsPage.total}
                    disabled={disabled}
                  />
                }
              />
            </div>

            <div className="h-full min-h-0 min-w-0 flex-1 @4xl/jobs-panes:hidden">
              <div className="mx-auto size-full min-h-0 px-4">{children}</div>
            </div>

            <div className="hidden h-full min-h-0 min-w-0 flex-1 @4xl/jobs-panes:block">
              <div className="mx-auto size-full min-h-0 px-4">{right}</div>
            </div>
          </div>
        </div>
        {modal}
        {disabled && <MarkAgentUnavailable agentId={agentId} />}
      </div>
    </JobsHeaderContext>
  );
}

/**
 * Names the agent while its jobs still load. The agent read is one call and
 * the jobs take several, so the header usually lands first; until then, and
 * if the read fails, the header's bones stay.
 */
async function LoadingJobsListHeader({
  params,
}: Pick<JobLayoutProps, "params">) {
  const { agentId } = await params;
  const agent = await getCoreAgentById(agentId).catch((error: unknown) => {
    unstable_rethrow(error);
    return null;
  });
  if (!agent) {
    return <JobsListHeaderSkeleton />;
  }
  return <JobsListHeader agent={agent} />;
}
