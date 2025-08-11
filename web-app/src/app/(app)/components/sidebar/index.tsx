import Link from "next/link";

import UserCredits from "@/app/components/user-credits";
import { SokosumiLogo, ThemedLogo } from "@/components/masumi-logos";
import { SheetClose } from "@/components/ui/sheet";
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
          <SheetClose asChild>
            <Link href="/">
              <ThemedLogo
                LogoComponent={SokosumiLogo}
                priority
                width={123}
                height={16}
              />
            </Link>
          </SheetClose>
          <CustomTrigger />
        </div>
      </SidebarHeader>
      <SidebarContent className="min-h-0 w-full flex-1">
        <AgentLists />
      </SidebarContent>
      <SidebarFooter className="shrink-0 px-0">
        <SheetClose asChild>
          <GalleryButton />
        </SheetClose>
        <div className="flex flex-1 gap-2 p-4 pt-0 md:hidden">
          <UserCredits />
        </div>
      </SidebarFooter>
    </ShadcnSidebar>
  );
}
