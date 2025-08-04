import {
  AgentWithCreditsPrice,
  AgentWithRelations,
  getAgentExampleOutput,
  getAgentLegal,
} from "@/lib/db";
import { cn } from "@/lib/utils";

import { CardSection } from "./card-section";
import { AgentDetailSection1, AgentDetailSection1Skeleton } from "./section-1";
import { AgentDetailSection2, AgentDetailSection2Skeleton } from "./section-2";
import { AgentDetailSection3, AgentDetailSection3Skeleton } from "./section-3";
import { AgentDetailSection4, AgentDetailSection4Skeleton } from "./section-4";
import { AgentDetailSection5, AgentDetailSection5Skeleton } from "./section-5";
import { AgentDetailSection6, AgentDetailSection6Skeleton } from "./section-6";

interface AgentDetailProps {
  agent: AgentWithCreditsPrice;
  executedJobsCount: number;
  averageExecutionDuration: number;
  favoriteAgents?: AgentWithRelations[] | undefined;
  showBackButton?: boolean | undefined;
  showCloseButton?: boolean | undefined;
  onClose?: (() => void) | undefined;
  className?: string | undefined;
  cardClassName?: string | undefined;
}

export function AgentDetail({
  agent,
  executedJobsCount,
  averageExecutionDuration,
  favoriteAgents,
  showBackButton,
  showCloseButton,
  onClose,
  className,
  cardClassName = "agent-detail-card p-3 md:p-6",
}: AgentDetailProps) {
  const exampleOutputs = getAgentExampleOutput(agent);
  const legal = getAgentLegal(agent);

  return (
    <div className={cn("flex w-full max-w-3xl flex-col gap-1.5", className)}>
      <CardSection className={cardClassName}>
        <AgentDetailSection1
          agent={agent}
          favoriteAgents={favoriteAgents}
          showBackButton={showBackButton}
          showCloseButton={showCloseButton}
          onClose={onClose}
        />
      </CardSection>
      <CardSection className={cardClassName}>
        <AgentDetailSection2
          executedJobsCount={executedJobsCount}
          averageExecutionDuration={averageExecutionDuration}
        />
      </CardSection>
      <CardSection className={cardClassName}>
        <AgentDetailSection3 agent={agent} />
      </CardSection>
      {exampleOutputs.length > 0 && (
        <CardSection className={cardClassName}>
          <AgentDetailSection4 exampleOutputs={exampleOutputs} />
        </CardSection>
      )}
      {legal && (
        <CardSection className={cardClassName}>
          <AgentDetailSection5 legal={legal} />
        </CardSection>
      )}
      <CardSection className={cardClassName}>
        <AgentDetailSection6 agent={agent} />
      </CardSection>
    </div>
  );
}

export function AgentDetailSkeleton({
  className,
}: {
  className?: string | undefined;
}) {
  return (
    <div className={cn("flex w-full max-w-3xl flex-col gap-1.5", className)}>
      <CardSection>
        <AgentDetailSection1Skeleton />
      </CardSection>
      <CardSection>
        <AgentDetailSection2Skeleton />
      </CardSection>
      <CardSection>
        <AgentDetailSection3Skeleton />
      </CardSection>
      <CardSection>
        <AgentDetailSection4Skeleton />
      </CardSection>
      <CardSection>
        <AgentDetailSection5Skeleton />
      </CardSection>
      <CardSection>
        <AgentDetailSection6Skeleton />
      </CardSection>
    </div>
  );
}
