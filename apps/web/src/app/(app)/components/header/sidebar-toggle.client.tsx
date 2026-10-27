"use client";

import { PanelLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId } from "react";

import { useChatTabUnreadPresence } from "@/app/chat/components/use-chat-tab-unread-presence";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import useIsApplePlatform from "@/hooks/use-is-apple-platform";

/**
 * The desktop sidebar toggle at the start of the top bar (App chrome). The
 * sidebar hides completely rather than leaving a rail, so this is where it
 * comes back from; ⌘B / Ctrl+B does the same through `SidebarProvider`. The
 * phone opens its sheet from its own chrome, so this renders nothing there.
 */
export function SidebarToggle() {
  const { open, isMobile } = useSidebar();

  if (isMobile) {
    return null;
  }

  return open ? <ToggleButton open /> : <HiddenSidebarToggle />;
}

/**
 * Hiding the sidebar must never hide a message, so while it is hidden the
 * toggle carries the phone Chats tab's unread signal as a dot, described to
 * assistive technology as "Unread chats". Mounted only while hidden, so the
 * presence reader runs only while the room list is out of sight.
 */
function HiddenSidebarToggle() {
  const t = useTranslations("App.Sidebar");
  const { showUnreadDot } = useChatTabUnreadPresence();
  const dotId = useId();

  return (
    <ToggleButton open={false} describedBy={showUnreadDot ? dotId : undefined}>
      {showUnreadDot ? (
        <span
          data-slot="sidebar-toggle-unread-dot"
          className="bg-primary ring-sidebar absolute top-1 right-1 size-1.5 rounded-full ring-2"
        >
          <span id={dotId} className="sr-only">
            {t("unreadChats")}
          </span>
        </span>
      ) : null}
    </ToggleButton>
  );
}

function ToggleButton({
  open,
  describedBy,
  children,
}: {
  open: boolean;
  describedBy?: string;
  children?: React.ReactNode;
}) {
  const t = useTranslations("App.Sidebar");
  const { toggleSidebar } = useSidebar();
  const isApple = useIsApplePlatform();
  const shortcut = isApple ? "⌘B" : "Ctrl+B";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={open ? t("hide") : t("show")}
          aria-expanded={open}
          aria-describedby={describedBy}
          aria-keyshortcuts="Meta+B Control+B"
          onClick={toggleSidebar}
          className="relative -ml-2 hidden size-10 shrink-0 md:inline-flex md:size-8"
        >
          <PanelLeft aria-hidden />
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {open
          ? t("hideShortcut", { shortcut })
          : t("showShortcut", { shortcut })}
      </TooltipContent>
    </Tooltip>
  );
}
