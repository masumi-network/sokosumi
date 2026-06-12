"use client";

import { PanelLeft } from "lucide-react";
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
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";

  if (isCollapsed) {
    return (
      <button
        type="button"
        onClick={toggleSidebar}
        className={cn(
          "group/logo relative hidden size-8 shrink-0 items-center justify-center rounded-md md:flex",
          "hover:bg-sidebar-accent",
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
    );
  }

  return (
    <div className="hidden h-8 items-center md:flex pl-2">
      <ThemedLogo LogoComponent={SokosumiLogo} height={16} width={123} />
    </div>
  );
}
