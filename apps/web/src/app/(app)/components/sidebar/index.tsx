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
import { Session } from "@/lib/auth/auth";

import AgentLists from "./components/agent-lists";
import CustomTrigger from "./components/custom-trigger";
import MenuItems from "./components/menu-items";

interface SidebarProps {
  session: Session;
}

export default function Sidebar({ session }: SidebarProps) {
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
      <SidebarContent className="min-h-0 w-full flex-1 pt-4">
        <MenuItems />
        <AgentLists userId={session.user.id} />
      </SidebarContent>
      <SidebarFooter className="shrink-0 px-0">
        <div className="flex flex-1 gap-2 p-4 pt-0 md:hidden">
          <UserCredits session={session} />
        </div>
      </SidebarFooter>
    </ShadcnSidebar>
  );
}
