import { Bookmark, Plus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { AgentBookmarkButton } from "@/components/agents/agent-bookmark-button";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getName } from "@/lib/db/extension/agent";
import { AgentWithRelations } from "@/lib/db/types/agent.types";
import { AgentListWithAgent } from "@/lib/db/types/agentList.types";
import { CreditsPrice } from "@/lib/db/types/credit.type";
import { convertCentsToCredits } from "@/lib/db/utils/credit.utils";

const bookmarkSize = 36;

export function HeaderSkeleton() {
  const t = useTranslations("App.Agents.Jobs.Header");

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
        <AgentBookmarkSection
          agentId={agent.id}
          favoriteAgentList={favoriteAgentList}
        />
        <h1 className="text-2xl font-bold text-nowrap xl:text-3xl">
          {getName(agent)}
        </h1>
      </div>
      <div className="flex flex-1 flex-row items-center justify-end gap-4">
        <div className="w-full text-end text-base">
          {t("price", {
            price: convertCentsToCredits(agentCreditsPrice.cents),
          })}
        </div>
        <Link href={`/app/agents/${agent.id}/jobs`}>
          <Button className="gap-2">
            <Plus />
            {t("createNewJob")}
          </Button>
        </Link>
      </div>
    </div>
  );
}
