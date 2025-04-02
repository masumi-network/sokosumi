import { Bookmark, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { AgentBookmarkButton } from "@/components/agents/agent-bookmark-button";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { requireAuthentication } from "@/lib/auth/utils";
import { getCreditsToDisplay, getName } from "@/lib/db/extension/agent";
import { AgentWithRelations } from "@/lib/db/services/agent.service";
import { getOrCreateFavoriteAgentList } from "@/lib/db/services/agentList.service";

interface HeaderProps {
  agent: AgentWithRelations;
  agentPricing: number;
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

async function AgentBookmarkSection({ agentId }: { agentId: string }) {
  const { session } = await requireAuthentication();

  const agentList = await getOrCreateFavoriteAgentList(session.user.id);

  return agentList ? (
    <AgentBookmarkButton agentId={agentId} agentList={agentList} />
  ) : (
    <InactiveBookmarkButton />
  );
}

export default async function Header({ agent, agentPricing }: HeaderProps) {
  const t = await getTranslations("App.Jobs.Header");

  return (
    <div className="flex flex-wrap items-center gap-4 lg:gap-6 xl:gap-8">
      <Suspense
        fallback={
          <Bookmark size={bookmarkSize} className="text-muted cursor-pointer" />
        }
      >
        <AgentBookmarkSection agentId={agent.id} />
      </Suspense>
      <h1 className="text-2xl font-bold xl:text-3xl">{getName(agent)}</h1>
      <Button className="gap-2">
        <Plus />
        {t("createNewJob")}
      </Button>
      <div className="text-base">
        {t("price", { price: getCreditsToDisplay(agentPricing) })}
      </div>
    </div>
  );
}
