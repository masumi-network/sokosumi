import { Bookmark, Plus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { AgentBookmarkButton } from "@/components/agents";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AgentListWithAgent,
  AgentWithRelations,
  convertCentsToCredits,
  CreditsPrice,
  getAgentName,
} from "@/lib/db";

const bookmarkSize = 36;

export function HeaderSkeleton() {
  const t = useTranslations("App.Agents.Jobs.Header");

  return (
    <div className="flex flex-col items-center gap-4 lg:flex-row lg:gap-6 xl:gap-8">
      <div className="flex flex-row items-center gap-4">
        <Skeleton className="h-8 w-60 xl:h-9" />
        <Skeleton className="h-6 w-16" />
        <Button variant="secondary" size="icon" disabled>
          <Bookmark className="animate-pulse" />
        </Button>
      </div>
      <div className="flex flex-1 flex-row items-center justify-end gap-4">
        <div className="w-full text-end text-sm font-semibold">
          <Skeleton className="ml-auto h-5 w-24" />
        </div>
        <Button className="gap-2" disabled>
          <Plus />
          {t("newJob")}
        </Button>
      </div>
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

interface HeaderProps {
  agent: AgentWithRelations;
  agentCreditsPrice: CreditsPrice;
  favoriteAgentList: AgentListWithAgent;
}

export default function Header({
  agent,
  agentCreditsPrice,
  favoriteAgentList,
}: HeaderProps) {
  const t = useTranslations("App.Agents.Jobs.Header");

  return (
    <div className="flex flex-col items-center gap-4 lg:flex-row lg:gap-6 xl:gap-8">
      <div className="flex flex-row items-center gap-4">
        <h1 className="text-3xl leading-none font-light tracking-tighter text-nowrap">
          {getAgentName(agent)}
        </h1>
        <Link
          href={`/app/agents/${agent.id}`}
          className="text-sm leading-tight font-medium"
        >
          {t("details")}
        </Link>
        <AgentBookmarkSection
          agentId={agent.id}
          favoriteAgentList={favoriteAgentList}
        />
      </div>
      <div className="flex flex-1 flex-row items-center justify-end gap-4">
        <div className="w-full text-end text-sm font-semibold">
          {t("price", {
            price: convertCentsToCredits(agentCreditsPrice.cents),
          })}
        </div>
        <Button variant="primary" className="gap-2" asChild>
          <Link href={`/app/agents/${agent.id}/jobs`}>
            <Plus />
            {t("newJob")}
          </Link>
        </Button>
      </div>
    </div>
  );
}
