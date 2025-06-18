import Link from "next/link";

import { SokosumiLogo, ThemedLogo } from "@/components/masumi-logos";
import {
  Sidebar as ShadcnSidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar";

import AgentLists from "./components/agent-lists";
import CustomTrigger from "./components/custom-trigger";
import GalleryButton from "./components/gallery-button";

export default function Sidebar() {
  return (
    <ShadcnSidebar>
      <SidebarHeader className="h-[64px] border-b">
        <div className="flex items-center justify-between gap-2 p-2">
          <Link href="/app">
            <ThemedLogo
              LogoComponent={SokosumiLogo}
              priority
              width={123}
              height={16}
            />
          </Link>
          <CustomTrigger />
        </div>
      </SidebarHeader>
      <SidebarContent className="w-full">
        <AgentLists />
      </SidebarContent>
      <SidebarFooter>
        <GalleryButton />
      </SidebarFooter>
    </ShadcnSidebar>
  );
}
