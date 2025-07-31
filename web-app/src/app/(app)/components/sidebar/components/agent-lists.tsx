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
import { getSessionOrThrow } from "@/lib/auth/utils";
import { AgentWithAvailability } from "@/lib/db";
import {
  getAgentJobStatusDataListByAgentIds,
  getAvailableAgents,
  getFavoriteAgents,
  getHiredAgentsOrderedByLatestJob,
} from "@/lib/services";
import { Agent } from "@/prisma/generated/client";

import AgentListsClient from "./agent-lists.client";

export default function AgentLists() {
  return (
    <Suspense fallback={<AgentListsSkeleton />}>
      <AgentListsContent />
    </Suspense>
  );
}

function AgentListsSkeleton() {
  return (
    <ScrollArea className="h-full">
      {[1, 2].map((groupIndex) => (
        <SidebarGroup key={groupIndex} className="w-full">
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

async function AgentListsContent() {
  const t = await getTranslations("App.Sidebar.Content.AgentLists");

  const session = await getSessionOrThrow();

  const [favoriteAgents, hiredAgentsWithJobs, availableAgents] =
    await Promise.all([
      getFavoriteAgents(),
      getHiredAgentsOrderedByLatestJob(),
      getAvailableAgents(),
    ]);

  const hiredAgents = filterDuplicatedAgents(
    hiredAgentsWithJobs,
    favoriteAgents,
  );

  const [favoriteAgentsJobStatusDataList, hiredAgentsJobStatusDataList] =
    await Promise.all([
      getAgentJobStatusDataListByAgentIds(
        favoriteAgents.map((agent) => agent.id),
      ),
      getAgentJobStatusDataListByAgentIds(hiredAgents.map((agent) => agent.id)),
    ]);

  // Determine availability for each agent
  const availableAgentIds = new Set(availableAgents.map((agent) => agent.id));
  const isAgentAvailable = (agentId: string) => availableAgentIds.has(agentId);

  // Transform agents to include availability information
  const favoriteAgentsWithAvailability: AgentWithAvailability[] =
    favoriteAgents.map((agent) => ({
      agent,
      isAvailable: isAgentAvailable(agent.id),
    }));

  const hiredAgentsWithAvailability: AgentWithAvailability[] = hiredAgents.map(
    (agent) => ({
      agent,
      isAvailable: isAgentAvailable(agent.id),
    }),
  );

  const agentLists = [
    {
      groupKey: "favorite-agents",
      title: t("pinnedTitle"),
      agents: favoriteAgentsWithAvailability,
      initialJobStatusDataList: favoriteAgentsJobStatusDataList,
      noAgentsType: t("pinnedType"),
    },
    {
      groupKey: "hired-agents",
      title: t("hiredTitle"),
      agents: hiredAgentsWithAvailability,
      initialJobStatusDataList: hiredAgentsJobStatusDataList,
      noAgentsType: t("hiredType"),
    },
  ];

  return (
    <ScrollArea className="h-full">
      <AgentListsClient agentLists={agentLists} userId={session.user.id} />
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
