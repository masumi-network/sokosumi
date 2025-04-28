import { CircleCheck, Clock, RefreshCcw, SquareTerminal } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";

import {
  AgentBadgeCloud,
  AgentHireButton,
  AgentVerifiedBadge,
} from "@/components/agents";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AgentListWithAgent,
  AgentWithRelations,
  convertCentsToCredits,
  CreditsPrice,
  getAgentAuthorName,
  getAgentDescription,
  getAgentLegal,
  getAgentName,
  getAgentResolvedImage,
  getAgentTags,
} from "@/lib/db";

import { AgentModalActionButtons } from "./agent-modal-action-buttons";

interface AgentModalProps {
  agent: AgentWithRelations | undefined;
  agentList?: AgentListWithAgent | undefined;
  agentCreditsPrice: CreditsPrice | undefined;
  onCloseModal: () => void;
}

function AgentModal({
  agent,
  agentList,
  agentCreditsPrice,
  onCloseModal,
}: AgentModalProps) {
  const handleOnOpenChange = (open: boolean) => {
    if (!open) {
      onCloseModal();
    }
  };

  return (
    <Dialog
      open={!!agent && !!agentCreditsPrice}
      onOpenChange={handleOnOpenChange}
    >
      <DialogPortal>
        <DialogOverlay className="backdrop-blur-lg" />
        <DialogContent className="w-10/12 max-w-3xl! border-none bg-transparent p-0 [&>button]:hidden">
          <DialogTitle className="hidden" />
          <DialogDescription className="hidden" />
          <ScrollArea className="max-h-[90svh]">
            {agent && agentCreditsPrice && (
              <div className="flex flex-col gap-1.5">
                <CardSection1
                  agent={agent}
                  agentList={agentList}
                  agentCreditsPrice={agentCreditsPrice}
                  onCloseModal={onCloseModal}
                />
                <CardSection2 agent={agent} />
                <CardSection3 agent={agent} />
                <CardSection4 agent={agent} />
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

function CardSection({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-muted/80 border-foreground/20 flex w-full flex-col gap-6 rounded-xl border-1 p-6 backdrop-blur-3xl">
      {children}
    </div>
  );
}

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
          <div className="bg-foreground absolute inset-0 blur-sm" />
          <Image
            src={getAgentResolvedImage(agent)}
            alt={getAgentName(agent)}
            fill
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
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

function CardSection2({ agent }: { agent: AgentWithRelations }) {
  const t = useTranslations("Components.Agents.AgentModal.Card2");
  const dateFormatter = useFormatter();

  return (
    <CardSection>
      <div className="grid grid-cols-2 lg:grid-cols-4">
        {/* Developer */}
        <div className="flex flex-col gap-0.5 border-r pr-6">
          <div className="flex items-center gap-1.5">
            <SquareTerminal size={16} />
            <span className="text-upper text-xs">{t("developer")}</span>
          </div>
          <p className="text-base font-medium">{getAgentAuthorName(agent)}</p>
        </div>
        {/* Running time */}
        <div className="flex flex-col gap-0.5 border-r px-6">
          <div className="flex items-center gap-1.5">
            <Clock size={16} />
            <span className="text-upper text-xs">{t("runningTime")}</span>
          </div>
          <p className="text-base font-medium">{"30 ~ 45 minutes"}</p>
        </div>
        {/* Executed Jobs */}
        <div className="flex flex-col gap-0.5 border-r px-6">
          <div className="flex items-center gap-1.5">
            <CircleCheck size={16} />
            <span className="text-upper text-xs">{t("executedJobs")}</span>
          </div>
          <p className="text-base font-medium">{"120 Tsd."}</p>
        </div>
        {/* Last Updated */}
        <div className="flex flex-col gap-0.5 px-6">
          <div className="flex items-center gap-1.5">
            <RefreshCcw size={16} />
            <span className="text-xs uppercase">{t("lastUpdated")}</span>
          </div>
          <p className="text-base font-medium">
            {dateFormatter.relativeTime(agent.updatedAt, new Date())}
          </p>
        </div>
      </div>
    </CardSection>
  );
}

function CardSection3({ agent }: { agent: AgentWithRelations }) {
  const t = useTranslations("Components.Agents.AgentModal.Card3");
  const agentDescription = getAgentDescription(agent);

  return (
    <CardSection>
      <div>
        {agentDescription && (
          <>
            <p className="text-xs uppercase">{t("title1")}</p>
            <p className="mt-2 mb-10 line-clamp-3">
              {getAgentDescription(agent)}
            </p>
          </>
        )}
        <p className="mb-2 text-xs uppercase">{t("title2")}</p>
        <AgentBadgeCloud tags={getAgentTags(agent)} />
      </div>
    </CardSection>
  );
}

function CardSection4({ agent }: { agent: AgentWithRelations }) {
  const t = useTranslations("Components.Agents.AgentModal.Card4");
  const legal = getAgentLegal(agent);

  if (!legal) {
    return null;
  }

  return (
    <CardSection>
      <div>
        <p className="mb-2 text-xs uppercase">{t("title")}</p>
        <div className="flex flex-wrap">
          {legal?.privacyPolicy && (
            <Link
              href={legal.privacyPolicy}
              className="hover:text-foreground underline underline-offset-4 transition-colors"
            >
              {t("privacyPolicy")}
            </Link>
          )}
          {legal?.terms && (
            <Link
              href={legal.terms}
              className="hover:text-foreground underline underline-offset-4 transition-colors"
            >
              {t("terms")}
            </Link>
          )}
          {legal?.other && (
            <Link
              href={legal.other}
              className="hover:text-foreground underline underline-offset-4 transition-colors"
            >
              {t("other")}
            </Link>
          )}
        </div>
      </div>
    </CardSection>
  );
}

export { AgentModal };
