"use client";
import { Bookmark, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { AgentBookmarkButton } from "@/components/agents/agent-bookmark-button";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getName } from "@/lib/db/extension/agent";
import { AgentWithRelations } from "@/lib/db/services/agent.service";
import { AgentListWithAgent } from "@/lib/db/services/agentList.service";

interface HeaderProps {
  agent: AgentWithRelations;
  agentPricing: number;
  favoriteAgentList: AgentListWithAgent;
}

const bookmarkSize = 36;

export function HeaderSkeleton() {
  const t = useTranslations("App.Jobs.Header");

  return (
    <div className="flex flex-wrap items-center gap-4 lg:gap-6 xl:gap-8">
      <Bookmark size={bookmarkSize} className="cursor-pointer" />
      <Skeleton className="h-10 w-60" />
      <Button className="gap-2">
        <Plus />
        {t("createNewJob")}
      </Button>
      <Skeleton className="h-10 w-30" />
    </div>
  );
}

function InactiveBookmarkButton() {
  return (
    <Bookmark
      size={bookmarkSize}
      className="text-muted cursor-not-allowed"
      aria-label="Bookmark not available"
    />
  );
}

function AgentBookmarkSection({
  favoriteAgentList,
  agentId,
}: {
  favoriteAgentList: AgentListWithAgent;
  agentId: string;
}) {
  return favoriteAgentList ? (
    <AgentBookmarkButton agentId={agentId} agentList={favoriteAgentList} />
  ) : (
    <InactiveBookmarkButton />
  );
}

export default function Header({
  agent,
  agentPricing,
  favoriteAgentList,
}: HeaderProps) {
  const t = useTranslations("App.Jobs.Header");
  const router = useRouter();
  return (
    <div className="flex flex-row items-center gap-4 lg:gap-6 xl:gap-8">
      <AgentBookmarkSection
        agentId={agent.id}
        favoriteAgentList={favoriteAgentList}
      />
      <h1 className="text-2xl font-bold text-nowrap xl:text-3xl">
        {getName(agent)}
      </h1>
      <div className="flex w-full flex-row items-center justify-end gap-5">
        <div className="w-full text-end text-base">
          {t("price", { price: agentPricing })}
        </div>
        <Button
          className="gap-2"
          onClick={() => {
            router.push(`/app/agents/${agent.id}/jobs`);
            router.refresh();
          }}
        >
          <Plus />
          {t("createNewJob")}
        </Button>
      </div>
    </div>
  );
}
