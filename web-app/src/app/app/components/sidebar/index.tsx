import Link from "next/link";

import { SokosumiLogo, ThemedLogo } from "@/components/masumi-logos";
import {
  Sidebar as ShadcnSidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar";

import AgentsList from "./components/agents-list";
import CustomTrigger from "./components/custom-trigger";
import GalleryButton from "./components/gallery-button";

export default function Sidebar() {
  return (
    <ShadcnSidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 p-2">
          <CustomTrigger />
          <Link href="/app" className="mx-auto">
            <ThemedLogo
              LogoComponent={SokosumiLogo}
              width={200}
              height={26}
              priority
            />
          </Link>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <AgentsList />
      </SidebarContent>
      <SidebarFooter>
        <GalleryButton />
      </SidebarFooter>
    </ShadcnSidebar>
  );
}
