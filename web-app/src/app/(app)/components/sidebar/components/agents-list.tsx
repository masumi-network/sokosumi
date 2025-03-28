import { AgentListType } from "@prisma/client";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { requireAuthentication } from "@/lib/auth/utils";
import { getOrCreateAgentListsByTypes } from "@/lib/db/services/agentList.service";
import { AppRoute } from "@/types/routes";

function AgentsListSkeleton() {
  return (
    <ScrollArea className="h-full">
      {[1, 2].map((groupIndex) => (
        <SidebarGroup key={groupIndex}>
          <SidebarGroupLabel className="text-base">
            <Skeleton className="h-5 w-24" />
          </SidebarGroupLabel>
          <SidebarGroupContent className="mt-2">
            <SidebarMenu>
              {[1, 2, 3].map((itemIndex) => (
                <SidebarMenuItem key={itemIndex}>
                  <SidebarMenuButton asChild>
                    <Skeleton className="h-4 w-32" />
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}

async function AgentsListContent() {
  const t = await getTranslations("App.Sidebar.Content.AgentsList");
  const { session } = await requireAuthentication();

  const agentLists = await getOrCreateAgentListsByTypes(session.user.id, [
    AgentListType.FAVORITE,
  ]);

  const agentListTitleTranslations: Record<AgentListType, string> = {
    [AgentListType.FAVORITE]: t("pinnedTitle"),
  };

  const agentListTypeTranslations: Record<AgentListType, string> = {
    [AgentListType.FAVORITE]: t("pinnedType"),
  };

  return (
    <ScrollArea className="h-full">
      {agentLists.map((list) => (
        <SidebarGroup key={list.id}>
          <SidebarGroupLabel className="text-base">
            {agentListTitleTranslations[list.type]}
          </SidebarGroupLabel>
          <SidebarGroupContent className="mt-2">
            {list.agents.length > 0 ? (
              <SidebarMenu>
                {list.agents.map((agent) => (
                  <SidebarMenuItem key={agent.id}>
                    <SidebarMenuButton asChild>
                      <Link href={`${AppRoute.Jobs}/${agent.id}`}>
                        <span className="whitespace-nowrap">{agent.name}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            ) : (
              <p className="text-muted-foreground px-3 text-sm">
                {t("noAgents", { type: agentListTypeTranslations[list.type] })}
              </p>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}

export default function AgentsList() {
  return (
    <Suspense fallback={<AgentsListSkeleton />}>
      <AgentsListContent />
    </Suspense>
  );
}
