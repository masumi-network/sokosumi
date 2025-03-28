import { AgentListType } from "@prisma/client";
import { Bookmark, Plus } from "lucide-react";
import { headers } from "next/headers";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

import { AgentBookmarkButton } from "@/components/agents/agent-bookmark-button";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { auth } from "@/lib/better-auth/auth";
import { AgentDTO } from "@/lib/db/dto/AgentDTO";
import {
  AgentListWithAgent,
  getOrCreateAgentListByType,
} from "@/lib/db/services/agentList.service";

interface HeaderProps {
  agent: AgentDTO;
}

export function HeaderSkeleton() {
  const t = useTranslations("App.Job.Header");

  return (
    <div className="flex flex-wrap items-center gap-4 lg:gap-6 xl:gap-8">
      <Bookmark size={36} className="cursor-pointer" />
      <Skeleton className="h-10 w-60" />
      <Button className="gap-2">
        <Plus />
        {t("createNewJob")}
      </Button>
      <Skeleton className="h-10 w-30" />
    </div>
  );
}

export default async function Header({ agent }: HeaderProps) {
  const t = await getTranslations("App.Job.Header");
  const { id: agentId, name, credits } = agent;

  const session = await auth.api.getSession({
    headers: await headers(),
  });
  const userId = session?.user.id;

  let agentList: AgentListWithAgent | undefined = undefined;
  if (userId) {
    agentList = await getOrCreateAgentListByType(
      userId,
      AgentListType.FAVORITE,
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-4 lg:gap-6 xl:gap-8">
      {agentList && (
        <AgentBookmarkButton agentId={agentId} agentList={agentList} />
      )}
      <h1 className="text-2xl font-bold xl:text-3xl">{name}</h1>
      <Button className="gap-2">
        <Plus />
        {t("createNewJob")}
      </Button>
      <div className="text-base">{t("price", { price: credits })}</div>
    </div>
  );
}
