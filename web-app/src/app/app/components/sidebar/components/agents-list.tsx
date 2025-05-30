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
import {
  getFavoriteAgents,
  getHiredAgentsOrderedByLatestJob,
} from "@/lib/services";
import { Agent } from "@/prisma/generated/client";

import AgentList from "./agent-list";

export default function AgentsList() {
  return (
    <Suspense fallback={<AgentsListSkeleton />}>
      <AgentsListContent />
    </Suspense>
  );
}

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

  const favoriteAgents = await getFavoriteAgents();
  const hiredAgents = filterDuplicatedAgents(
    await getHiredAgentsOrderedByLatestJob(),
    favoriteAgents,
  );

  return (
    <ScrollArea className="h-full">
      <AgentList
        groupKey="favorite-agents"
        title={t("pinnedTitle")}
        agents={favoriteAgents}
        noAgentsType={t("pinnedType")}
      />

      <AgentList
        groupKey="hired-agents"
        title={t("hiredTitle")}
        agents={hiredAgents}
        noAgentsType={t("hiredType")}
      />
    </ScrollArea>
  );
}

function filterDuplicatedAgents(hiredAgents: Agent[], favoriteAgents: Agent[]) {
  return hiredAgents.filter((hiredAgent) => {
    return !favoriteAgents.some(
      (favoriteAgent) => favoriteAgent.id === hiredAgent.id,
    );
  });
}
