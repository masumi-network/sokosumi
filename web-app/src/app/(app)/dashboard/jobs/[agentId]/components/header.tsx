import { AgentListType } from "@prisma/client";
import { Bookmark, Plus } from "lucide-react";
import { headers } from "next/headers";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { AgentBookmarkButton } from "@/components/agents/agent-bookmark-button";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { auth } from "@/lib/better-auth/auth";
import { AgentDTO } from "@/lib/db/dto/AgentDTO";
import { getOrCreateAgentListByType } from "@/lib/db/services/agentList.service";

interface HeaderProps {
  agent: AgentDTO;
}

const bookmarkSize = 36;

export function HeaderSkeleton() {
  const t = useTranslations("App.Job.Header");

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
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user.id) return <InactiveBookmarkButton />;

    const agentList = await getOrCreateAgentListByType(
      session.user.id,
      AgentListType.FAVORITE,
    );

    return agentList ? (
      <AgentBookmarkButton agentId={agentId} agentList={agentList} />
    ) : (
      <InactiveBookmarkButton />
    );
  } catch {
    return <InactiveBookmarkButton />;
  }
}

export default async function Header({ agent }: HeaderProps) {
  const t = await getTranslations("App.Job.Header");
  const { id: agentId, name, credits } = agent;

  return (
    <div className="flex flex-wrap items-center gap-4 lg:gap-6 xl:gap-8">
      <Suspense
        fallback={
          <Bookmark size={bookmarkSize} className="text-muted cursor-pointer" />
        }
      >
        <AgentBookmarkSection agentId={agentId} />
      </Suspense>
      <h1 className="text-2xl font-bold xl:text-3xl">{name}</h1>
      <Button className="gap-2">
        <Plus />
        {t("createNewJob")}
      </Button>
      <div className="text-base">{t("price", { price: credits })}</div>
    </div>
  );
}
