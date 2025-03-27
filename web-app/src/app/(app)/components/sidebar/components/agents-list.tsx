import { headers } from "next/headers";
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
import { auth } from "@/lib/better-auth/auth";
import { getAgentLists } from "@/lib/db/services/agentList.service";

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
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  const userId = session?.user.id;
  console.log(userId);
  if (!userId) {
    return null;
  }

  const agentLists = await getAgentLists(userId);
  console.log(agentLists);
  if (!agentLists) {
    return null;
  }

  return (
    <ScrollArea className="h-full">
      {agentLists.map((list) => (
        <SidebarGroup key={list.id}>
          <SidebarGroupLabel className="text-base">
            {t(list.listType)}
          </SidebarGroupLabel>
          <SidebarGroupContent className="mt-2">
            <SidebarMenu>
              {list.agent.map((agent) => (
                <SidebarMenuItem key={agent.id}>
                  <SidebarMenuButton asChild>
                    <span className="whitespace-nowrap">{agent.name}</span>
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

export default function AgentsList() {
  return (
    <Suspense fallback={<AgentsListSkeleton />}>
      <AgentsListContent />
    </Suspense>
  );
}
