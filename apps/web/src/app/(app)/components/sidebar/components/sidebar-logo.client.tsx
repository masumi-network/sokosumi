"use client";

import {
  SokosumiIcon,
  SokosumiLogo,
  ThemedLogo,
} from "@/components/masumi-logos";
import { useSidebar } from "@/components/ui/sidebar";

export default function SidebarLogo() {
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  return (
    <div className="hidden items-center justify-center p-2 md:flex">
      {isCollapsed ? (
        <SokosumiIcon animated className="size-8" />
      ) : (
        <div className="h-8">
          <ThemedLogo LogoComponent={SokosumiLogo} />
        </div>
      )}
    </div>
  );
}
