import Image from "next/image";
import { useTranslations } from "next-intl";

import {
  AgentActionButtons,
  AgentActionButtonsSkeleton,
} from "@/components/agents/agent-action-buttons";
import { AgentNewBadge } from "@/components/agents/agent-badge-cloud";
import { AgentHireButton } from "@/components/agents/agent-hire-button";
import { AgentVerifiedBadge } from "@/components/agents/agent-verified-badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AgentWithRelations,
  convertCentsToCredits,
  CreditsPrice,
  getAgentName,
  getAgentResolvedImage,
  getFullAgentAuthorName,
} from "@/lib/db";

interface AgentDetailSection1Props {
  agent: AgentWithRelations;
  favoriteAgents: AgentWithRelations[] | undefined;
  agentCreditsPrice: CreditsPrice;
  showBackButton?: boolean | undefined;
  showCloseButton?: boolean | undefined;
  onClose?: (() => void) | undefined;
}

function AgentDetailSection1({
  agent,
  favoriteAgents,
  agentCreditsPrice,
  showBackButton,
  showCloseButton,
  onClose,
}: AgentDetailSection1Props) {
  const t = useTranslations("Components.Agents.AgentDetail.Section1");

  return (
    <div className="flex flex-col gap-6">
      <AgentActionButtons
        agent={agent}
        favoriteAgents={favoriteAgents}
        showBackButton={showBackButton}
        showCloseButton={showCloseButton}
        onClose={onClose}
      />
      <div className="flex flex-col gap-6 md:flex-row">
        <div className="relative aspect-square w-full shrink-0 md:h-48 md:w-48">
          <Image
            src={getAgentResolvedImage(agent)}
            alt={getAgentName(agent)}
            fill
            sizes="(max-width: 768px) 50vw, 33vw"
            className="rounded-lg object-cover"
            priority
          />
          {agent.isNew && (
            <div className="absolute top-0 left-0 p-3">
              <AgentNewBadge />
            </div>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-8 md:gap-1.5">
          <div className="flex flex-1 flex-col gap-2">
            <div className="flex items-start gap-4 md:items-center">
              <h2 className="text-2xl font-light md:text-3xl">
                {getAgentName(agent)}
              </h2>
              <AgentVerifiedBadge />
            </div>
            <div className="flex items-center gap-3">
              <div className="relative h-8 w-8">
                <Image
                  src="/images/agent/agent-detail-author.jpg"
                  alt="author"
                  fill
                  sizes="100px"
                  className="rounded-full object-cover"
                />
              </div>
              <p className="text-muted-foreground text-sm md:text-base">
                {getFullAgentAuthorName(agent)}
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="text-sm md:text-base">
              <span className="font-medium">
                {t("pricing", {
                  credits: convertCentsToCredits(agentCreditsPrice.cents),
                })}
              </span>
            </div>
            <AgentHireButton agentId={agent.id} />
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentDetailSection1Skeleton() {
  return (
    <div className="flex flex-col gap-6">
      <AgentActionButtonsSkeleton />
      <div className="flex flex-col gap-6 md:flex-row">
        <Skeleton className="aspect-square w-full rounded-lg md:h-48 md:w-48" />
        <div className="flex flex-1 flex-col gap-8 md:gap-1.5">
          <div className="flex flex-1 flex-col gap-2">
            <div className="flex items-start gap-4 md:items-center">
              <Skeleton className="h-8 w-40" />
              <Skeleton className="h-8 w-16" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-8 rounded-full" />
              <Skeleton className="h-4 w-24" />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="text-base">
              <Skeleton className="h-8 w-24" />
            </div>
            <Skeleton className="h-8 w-24" />
          </div>
        </div>
      </div>
    </div>
  );
}

export { AgentDetailSection1, AgentDetailSection1Skeleton };
