"use client";

import { Bot } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { AuroraOrb } from "@/components/aurora-orb";
import { publishPersonalAssistantChromeVisible } from "@/components/chat/personal-assistant-chrome-store";
import { SheetClose } from "@/components/ui/sheet";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRailSelectionBar,
  SidebarRowSlot,
} from "@/components/ui/sidebar";
import {
  SIDEBAR_ROW_FIXED_LABEL_CLASS,
  SIDEBAR_ROW_LABEL_CLASS,
} from "@/components/ui/sidebar-classes";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { SOKO_BOT_ROUTE, SOKO_BOTS_ROUTE } from "@/lib/soko-bot/constants";
import { cn } from "@/lib/utils";

/**
 * Soko Bots entry at the top of the sidebar: the team chart of everyone's
 * assistants, and where a person creates their own. Set apart from the rest
 * of the nav by a divider rendered in the sidebar composition.
 */
export interface SidebarSokoBotAvatar {
  id: string;
  imageUrl: string | null;
  seed: string;
}

export default function PersonalAssistantNav({
  bot = null,
}: {
  bot?: SidebarSokoBotAvatar | null;
}) {
  const t = useTranslations("App.Sidebar.Content.MenuItems");
  const pathname = usePathname();
  const isActive = [SOKO_BOTS_ROUTE, SOKO_BOT_ROUTE].some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

  useMountEffect(() => {
    // Session memory for Instant `/chat` (SOK-903): mount means beta chrome is on.
    publishPersonalAssistantChromeVisible(true);
  });

  return (
    <SidebarGroup className="w-full">
      <SidebarGroupContent>
        <SidebarMenu className="gap-0">
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={isActive}
              tooltip={t("sokoBot")}
            >
              <SheetClose asChild>
                <Link
                  href={SOKO_BOTS_ROUTE}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    isActive
                      ? "text-sidebar-accent-foreground"
                      : "text-tertiary-foreground dark:text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )}
                >
                  <SidebarRowSlot>
                    {bot ? (
                      <BotFace bot={bot} />
                    ) : (
                      <Bot className="size-4" aria-hidden />
                    )}
                  </SidebarRowSlot>
                  <span
                    className={cn(
                      SIDEBAR_ROW_LABEL_CLASS,
                      SIDEBAR_ROW_FIXED_LABEL_CLASS,
                      "font-medium",
                    )}
                  >
                    {t("sokoBot")}
                  </span>
                </Link>
              </SheetClose>
            </SidebarMenuButton>
            {isActive ? <SidebarRailSelectionBar /> : null}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/**
 * The workspace's first Soko Bot — yours when you have one.
 *
 * 20px, the size every face in this sidebar is: this row stands directly
 * above the chat lists, so a face here and a Direct's face below it are read
 * as one column. One size in both states, so the toggle cannot resize it.
 */
function BotFace({ bot }: { bot: SidebarSokoBotAvatar }) {
  const className = "size-5 shrink-0 rounded-full object-cover";

  if (bot.imageUrl) {
    return <img src={bot.imageUrl} alt="" className={className} aria-hidden />;
  }

  return <AuroraOrb seed={bot.seed} size={40} className={className} />;
}
