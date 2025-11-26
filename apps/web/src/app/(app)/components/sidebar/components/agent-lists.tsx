import { Agent } from "@sokosumi/database";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { agentService, jobService } from "@/lib/services";
import { AgentWithAvailability } from "@/lib/types/agent";

import AgentListsClient from "./agent-lists.client";

interface AgentListsProps {
  userId: string;
}

export default function AgentLists({ userId }: AgentListsProps) {
  return (
    <Suspense fallback={<AgentListsSkeleton />}>
      <AgentListsContent userId={userId} />
    </Suspense>
  );
}

function AgentListsSkeleton() {
  return (
    <>
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
    </>
  );
}

async function AgentListsContent({ userId }: { userId: string }) {
  const t = await getTranslations("App.Sidebar.Content.AgentLists");

  const [favoriteAgents, hiredAgentsWithJobs, availableAgents] =
    await Promise.all([
      agentService.getFavoriteAgents(),
      agentService.getHiredAgents(),
      agentService.getAvailableAgents(),
    ]);

  const hiredAgents = filterDuplicatedAgents(
    hiredAgentsWithJobs,
    favoriteAgents,
  );

  const [favoriteAgentsJobStatusesData, hiredAgentsJobStatusesData] =
    await Promise.all([
      jobService.getJobStatusesDataForAgents(
        favoriteAgents.map((agent) => agent.id),
      ),
      jobService.getJobStatusesDataForAgents(
        hiredAgents.map((agent) => agent.id),
      ),
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
      initialJobStatusesData: favoriteAgentsJobStatusesData,
      noAgentsType: t("pinnedType"),
      iconKey: "pin",
    },
    {
      groupKey: "hired-agents",
      title: t("hiredTitle"),
      agents: hiredAgentsWithAvailability,
      initialJobStatusesData: hiredAgentsJobStatusesData,
      noAgentsType: t("hiredType"),
      iconKey: "history",
    },
  ];

  return <AgentListsClient agentLists={agentLists} userId={userId} />;
}

function filterDuplicatedAgents(hiredAgents: Agent[], favoriteAgents: Agent[]) {
  return hiredAgents.filter((hiredAgent) => {
    return !favoriteAgents.some(
      (favoriteAgent) => favoriteAgent.id === hiredAgent.id,
    );
  });
}
