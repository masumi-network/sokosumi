"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useQueryState } from "nuqs";
import { Suspense } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import useAgentDetail from "@/hooks/use-agent-detail";
import { AgentListWithAgent } from "@/lib/db";

import {
  CardSection,
  CardSection1,
  CardSection1Skeleton,
  CardSection2,
  CardSection2Skeleton,
  CardSection3,
  CardSection3Skeleton,
  CardSection4,
  CardSection4Skeleton,
  CardSection5,
  CardSection5Skeleton,
} from "./card-sections";

interface AgentModalProps {
  agentList?: AgentListWithAgent | undefined;
}

function AgentModal({ agentList }: AgentModalProps) {
  return (
    <Suspense>
      <AgentModalClient agentList={agentList} />
    </Suspense>
  );
}

function AgentModalClient({ agentList }: AgentModalProps) {
  const [agentId, setAgentId] = useQueryState("agentId");
  const { agent, agentCreditsPrice, isLoading, error } =
    useAgentDetail(agentId);

  const handleOnOpenChange = (open: boolean) => {
    if (!open) {
      setAgentId(null);
    }
  };

  const onCloseModal = () => {
    setAgentId(null);
  };

  if (!agentId) {
    return null;
  }

  return (
    <Dialog defaultOpen={true} onOpenChange={handleOnOpenChange}>
      <DialogPortal>
        <DialogOverlay className="backdrop-blur-lg" />
        <DialogContent className="w-[80vw] max-w-3xl! border-none bg-transparent p-0 [&>button]:hidden">
          <DialogTitle className="hidden" />
          <DialogDescription className="hidden" />
          <ScrollArea className="max-h-[90svh]">
            <div className="flex w-[80vw] max-w-3xl! flex-col gap-1.5">
              {isLoading ? (
                <AgentModalSkeleton />
              ) : error || !agent || !agentCreditsPrice ? (
                <AgentModalError />
              ) : (
                <>
                  <CardSection1
                    agent={agent}
                    agentList={agentList}
                    agentCreditsPrice={agentCreditsPrice}
                    onCloseModal={onCloseModal}
                  />
                  <CardSection2 agent={agent} />
                  <CardSection3 agent={agent} />
                  <CardSection4 agent={agent} />
                  <CardSection5 agent={agent} />
                </>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

function AgentModalSkeleton() {
  return (
    <>
      <CardSection1Skeleton />
      <CardSection2Skeleton />
      <CardSection3Skeleton />
      <CardSection4Skeleton />
      <CardSection5Skeleton />
    </>
  );
}

function AgentModalError() {
  const t = useTranslations("Components.Agents.AgentModal");
  return (
    <CardSection>
      <div className="flex min-h-[120px] w-full items-center justify-center rounded-md border border-red-300 bg-red-50 p-4">
        <span className="text-lg text-red-500">{t("error")}</span>
      </div>
      <Button asChild variant="outline" className="w-full">
        <Link href="/agents">{t("backToAgents")}</Link>
      </Button>
    </CardSection>
  );
}

export { AgentModal };
