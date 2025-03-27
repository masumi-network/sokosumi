import { useTranslations } from "next-intl";

import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const agentsGroups: Array<{
  labelKey: keyof IntlMessages["App"]["Sidebar"]["Content"]["AgentsList"];
  agents: string[];
}> = [
  {
    labelKey: "pinned",
    agents: Array.from(
      { length: 10 },
      (_, index) => `Pinned Agent #${index + 1}`,
    ),
  },
  {
    labelKey: "recentlyUsed",
    agents: Array.from(
      { length: 10 },
      (_, index) => `Recently Used Agent #${index + 1}`,
    ),
  },
];

export default function AgentsList() {
  const t = useTranslations("App.Sidebar.Content.AgentsList");

  return (
    <ScrollArea className="h-full">
      {agentsGroups.map((group) => (
        <SidebarGroup key={group.labelKey}>
          <SidebarGroupLabel className="text-base">
            {t(group.labelKey)}
          </SidebarGroupLabel>
          <SidebarGroupContent className="mt-2">
            <SidebarMenu>
              {group.agents.map((agent) => (
                <SidebarMenuItem key={agent}>
                  <SidebarMenuButton asChild>
                    <span className="whitespace-nowrap">{agent}</span>
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
