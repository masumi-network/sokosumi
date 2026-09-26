"use client";

import { PanelLeft } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import {
  SokosumiIcon,
  SokosumiLogo,
  ThemedLogo,
} from "@/components/masumi-logos";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

export default function SidebarLogo() {
  const t = useTranslations("Components.UserAvatar");
  const { toggleSidebar } = useSidebar();

  // Boot script collapses via `data-collapsible` before hydration. A React
  // `state` branch would still paint the wordmark in the 56px rail until then.
  return (
    <>
      <button
        type="button"
        onClick={toggleSidebar}
        className={cn(
          "group/logo relative hidden size-8 shrink-0 items-center justify-center rounded-md group-data-[collapsible=icon]:md:flex",
          // Same rail language as `sidebarMenuButtonVariants`: hover is a
          // ring on transparent, deepened on press, never a fill.
          "ring-sidebar-ring hover:ring-1 active:ring-2",
        )}
        aria-label={t("expandSidebar")}
      >
        <SokosumiIcon
          animated
          className="size-8 transition-opacity group-hover/logo:opacity-0"
        />
        <PanelLeft
          className="absolute size-4 opacity-0 transition-opacity group-hover/logo:opacity-100"
          aria-hidden
        />
      </button>
      <div className="flex h-8 items-center pl-2 group-data-[collapsible=icon]:hidden">
        <Link href="/" className="hover:opacity-80 transition-opacity">
          <ThemedLogo LogoComponent={SokosumiLogo} height={16} width={123} />
        </Link>
      </div>
    </>
  );
}
