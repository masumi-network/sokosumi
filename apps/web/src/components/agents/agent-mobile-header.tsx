"use client";

import { ArrowLeft } from "lucide-react";

import { AgentActionButtons } from "@/components/agents/agent-action-buttons";
import { Button } from "@/components/ui/button";
import { AgentWithCreditsPrice, AgentWithRelations } from "@/lib/db";

export function HeaderSkeleton() {
  return (
    <div className="md:justify-initial flex flex-col items-center gap-4 md:hidden lg:flex-row lg:gap-6 xl:gap-8">
      <div className="md:justify-initial flex w-full flex-row items-center justify-between gap-4 md:w-auto md:flex-initial">
        <Button
          variant="secondary"
          size="icon"
          disabled
          className="flex md:hidden"
        >
          <ArrowLeft className="animate-pulse" />
        </Button>
      </div>
    </div>
  );
}

interface HeaderProps {
  agent: AgentWithCreditsPrice;
  favoriteAgents?: AgentWithRelations[] | undefined;
}

export default function AgentMobileHeader({ agent }: HeaderProps) {
  return (
    <div className="flex flex-col items-center gap-4 pt-8 md:hidden md:pt-0 lg:flex-row lg:gap-6 xl:gap-8">
      <div className="bg-background/95 fixed top-[64px] z-50 flex w-full flex-row items-center justify-between gap-4 p-4">
        <AgentActionButtons
          agent={agent}
          showBackButton={true}
          showShareButton={true}
          showCloseButton={false}
        ></AgentActionButtons>
      </div>
    </div>
  );
}
