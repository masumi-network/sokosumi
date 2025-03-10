import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const agentsGroups = [
  {
    label: "Pinned Agents",
    agents: Array.from(
      { length: 10 },
      (_, index) => `Pinned Agent #${index + 1}`,
    ),
  },
  {
    label: "Recently Used Agents",
    agents: Array.from(
      { length: 10 },
      (_, index) => `Recently Used Agent #${index + 1}`,
    ),
  },
];

export default function AgentsList() {
  return (
    <ScrollArea className="h-full">
      {agentsGroups.map((group) => (
        <SidebarGroup key={group.label}>
          <SidebarGroupLabel className="text-base">
            {group.label}
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
