import Image from "next/image";
import { useTranslations } from "next-intl";

import { AgentHireButton } from "@/components/agents/agent-hire-button";
import {
  AgentModalActionButtons,
  AgentModalActionButtonsSkeleton,
} from "@/components/agents/agent-modal/agent-modal-action-buttons";
import { AgentVerifiedBadge } from "@/components/agents/agent-verified-badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AgentListWithAgent,
  AgentWithRelations,
  convertCentsToCredits,
  CreditsPrice,
  getAgentName,
  getAgentResolvedImage,
} from "@/lib/db";

import { CardSection } from "./card-section";

function CardSection1({
  agent,
  agentList,
  agentCreditsPrice,
  onCloseModal,
}: {
  agent: AgentWithRelations;
  agentList: AgentListWithAgent | undefined;
  agentCreditsPrice: CreditsPrice;
  onCloseModal: () => void;
}) {
  const t = useTranslations("Components.Agents.AgentModal.Card1");

  return (
    <CardSection>
      <AgentModalActionButtons
        agent={agent}
        agentList={agentList}
        onCloseModal={onCloseModal}
      />
      <div className="flex gap-6">
        <div className="relative h-56 w-56 shrink-0">
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
          <div className="flex-1">
            <div className="flex items-center gap-4">
              <h2 className="text-3xl font-light">{getAgentName(agent)}</h2>
              <AgentVerifiedBadge />
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
            <AgentHireButton agentId={agent.id} />
          </div>
        </div>
      </div>
    </CardSection>
  );
}

function CardSection1Skeleton() {
  return (
    <CardSection>
      <AgentModalActionButtonsSkeleton />
      <div className="flex gap-6">
        <Skeleton className="h-56 w-56 rounded-lg" />
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="flex-1">
            <div className="flex items-center gap-4">
              <Skeleton className="h-8 w-40" />
              <Skeleton className="h-8 w-16" />
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
    </CardSection>
  );
}

export { CardSection1, CardSection1Skeleton };
