import Image from "next/image";
import { useTranslations } from "next-intl";

import {
  AgentActionButtons,
  AgentActionButtonsSkeleton,
} from "@/components/agents/agent-action-buttons";
import { AgentHireButton } from "@/components/agents/agent-hire-button";
import { AgentVerifiedBadge } from "@/components/agents/agent-verified-badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AgentListWithAgent,
  AgentWithRelations,
  convertCentsToCredits,
  CreditsPrice,
  getAgentAuthorName,
  getAgentName,
  getAgentResolvedImage,
} from "@/lib/db";

interface AgentDetailSection1Props {
  agent: AgentWithRelations;
  agentList: AgentListWithAgent | undefined;
  agentCreditsPrice: CreditsPrice;
  showBackButton?: boolean | undefined;
  showCloseButton?: boolean | undefined;
  onClose?: (() => void) | undefined;
}

function AgentDetailSection1({
  agent,
  agentList,
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
        agentList={agentList}
        showBackButton={showBackButton}
        showCloseButton={showCloseButton}
        onClose={onClose}
      />
      <div className="flex gap-6">
        <div className="relative h-48 w-48 shrink-0">
          <div className="absolute inset-0 rounded-lg blur-sm" />
          <Image
            src={getAgentResolvedImage(agent)}
            alt={getAgentName(agent)}
            fill
            sizes="(max-width: 768px) 50vw, 33vw"
            className="rounded-lg object-cover"
            priority
          />
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="flex flex-1 flex-col gap-2">
            <div className="flex items-center gap-4">
              <h2 className="text-3xl font-light">{getAgentName(agent)}</h2>
              <AgentVerifiedBadge />
            </div>
            <div className="flex items-center gap-3">
              <div className="relative h-8 w-8">
                <Image
                  src="/backgrounds/visuals/blurry-ink-wave-1.png"
                  alt="author"
                  fill
                  sizes="100px"
                  className="rounded-full object-cover"
                />
              </div>
              <p className="text-muted-foreground">
                {getAgentAuthorName(agent)}
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="text-base">
              <span className="font-medium">
                {t("pricing", {
                  credits: convertCentsToCredits(agentCreditsPrice.cents),
                })}
              </span>
            </div>
            <AgentHireButton />
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
      <div className="flex gap-6">
        <Skeleton className="h-56 w-56 rounded-lg" />
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="flex flex-1 flex-col gap-2">
            <div className="flex items-center gap-4">
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
