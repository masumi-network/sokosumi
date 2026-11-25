"use client";

import { PanelLeft } from "lucide-react";
import { useTranslations } from "next-intl";

import { useChromePathname } from "@/app/chat/components/room-cache-provider";
import { isChatRoomPathname } from "@/app/chat/utils/chat-route-base";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { useSidebar } from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import useIsApplePlatform from "@/hooks/use-is-apple-platform";
import { cn } from "@/lib/utils";

/** Toggle the contextual panel; the global rail stays available on desktop. */
export function SidebarToggle() {
  const t = useTranslations("App.Sidebar");
  const { isMobile, open, openMobile, toggleSidebar } = useSidebar();
  const pathname = useChromePathname();
  const isApple = useIsApplePlatform();
  const shortcut = isApple ? "⌘B" : "Ctrl+B";
  const expanded = isMobile ? openMobile : open;
  const label = expanded ? t("hide") : t("show");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          aria-expanded={expanded}
          aria-keyshortcuts="Meta+B Control+B"
          id="app-sidebar-toggle"
          onClick={toggleSidebar}
          className={cn(
            "size-10 shrink-0 md:-ml-2 md:size-8",
            isChatRoomPathname(pathname) && "max-md:hidden",
          )}
        >
          <PanelLeft aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        sideOffset={6}
        className="flex items-center gap-2"
      >
        {label}
        <Kbd className="opacity-70">{shortcut}</Kbd>
      </TooltipContent>
    </Tooltip>
  );
}
