import { SokosumiLogo } from "@/components/masumi-logos";
import {
  Sidebar as ShadcnSidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar";

import AgentAddButton from "./components/agent-add-button";
import AgentsList from "./components/agents-list";
import CustomTrigger from "./components/custom-trigger";

export default function Sidebar() {
  return (
    <ShadcnSidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 p-2">
          <CustomTrigger />
          <SokosumiLogo />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <AgentsList />
      </SidebarContent>
      <SidebarFooter>
        <AgentAddButton />
      </SidebarFooter>
    </ShadcnSidebar>
  );
}
