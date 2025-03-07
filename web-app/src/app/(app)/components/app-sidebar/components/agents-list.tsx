import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const pinnedAgents = Array.from(
  { length: 10 },
  (_, index) => `Random Agent #${index + 1}`,
);
const recentlyUsedAgents = Array.from(
  { length: 10 },
  (_, index) => `Random Agent #${index + 1}`,
);

export default function AgentsList() {
  return (
    <>
      <SidebarGroup>
        <SidebarGroupLabel className="text-base">
          Pinned Agents
        </SidebarGroupLabel>
        <SidebarGroupContent className="mt-2">
          <SidebarMenu>
            {pinnedAgents.map((agent) => (
              <SidebarMenuItem key={agent}>
                <SidebarMenuButton asChild>
                  <span>{agent}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      <SidebarGroup>
        <SidebarGroupLabel className="text-base">
          Recently Hired Agents
        </SidebarGroupLabel>
        <SidebarGroupContent className="mt-2">
          <SidebarMenu>
            {recentlyUsedAgents.map((agent) => (
              <SidebarMenuItem key={agent}>
                <SidebarMenuButton asChild>
                  <span>{agent}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}
