"use client";

import { AgentWithCreditsPrice } from "@sokosumi/database";
import { Suspense, use } from "react";

import { AgentCard, AgentCardSkeleton } from "@/components/agents";
import {
  CreateJobModal,
  CreateJobModalContextProvider,
} from "@/components/create-job-modal";
import DefaultErrorBoundary from "@/components/default-error-boundary";

interface RandomAgentCardProps {
  randomAgentPromise: Promise<{
    agent: AgentWithCreditsPrice;
    averageExecutionDuration: number;
  } | null>;
}

export default function RandomAgentCard(props: RandomAgentCardProps) {
  return (
    <Suspense fallback={<RandomAgentCardContentLoading />}>
      <DefaultErrorBoundary fallback={null}>
        <RandomAgentCardInner {...props} />
      </DefaultErrorBoundary>
    </Suspense>
  );
}

function RandomAgentCardInner(props: RandomAgentCardProps) {
  const randomAgent = use(props.randomAgentPromise);

  if (!randomAgent) {
    return null;
  }

  return <RandomAgentCardContent {...randomAgent} />;
}

function RandomAgentCardContent({
  agent,
  averageExecutionDuration,
}: {
  agent: AgentWithCreditsPrice;
  averageExecutionDuration: number;
}) {
  return (
    <CreateJobModalContextProvider
      agentsWithPrice={[agent]}
      averageExecutionDuration={averageExecutionDuration}
    >
      <AgentCard
        agent={agent}
        showHireButton
        className="mx-auto gap-2 bg-transparent"
      />
      {/* Create Job Modal */}
      <CreateJobModal />
    </CreateJobModalContextProvider>
  );
}

function RandomAgentCardContentLoading() {
  return <AgentCardSkeleton />;
}
