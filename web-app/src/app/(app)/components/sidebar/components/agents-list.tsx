import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";

import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { auth } from "@/lib/better-auth/auth";
import { getAgentLists } from "@/lib/db/services/agentList.service";

export default async function AgentsList() {
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
