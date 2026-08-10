import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
} from "@/components/ui/sidebar";

export function AppSidebarFallback() {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-sidebar-border h-16 border-b p-0" />
      <SidebarContent className="min-h-0 w-full flex-1" />
    </Sidebar>
  );
}
