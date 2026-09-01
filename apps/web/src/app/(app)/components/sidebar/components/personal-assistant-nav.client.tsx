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
} from "@/components/ui/sidebar";
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

const MAX_STACK = 3;

/** Up to three workspace Soko Bots, overlapping like a team roster. */
function BotStack({ bots }: { bots: SidebarSokoBotAvatar[] }) {
  return (
    <span className="flex shrink-0 -space-x-1.5" aria-hidden>
      {bots
        .slice(0, MAX_STACK)
        .map((bot) =>
          bot.imageUrl ? (
            <img
              key={bot.id}
              src={bot.imageUrl}
              alt=""
              className="size-5 rounded-full object-cover"
            />
          ) : (
            <AuroraOrb
              key={bot.id}
              seed={bot.seed}
              size={40}
              className="size-5"
            />
          ),
        )}
    </span>
  );
}

export default function PersonalAssistantNav({
  bots = [],
}: {
  bots?: SidebarSokoBotAvatar[];
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
            <SidebarMenuButton asChild isActive={isActive} size="lg">
              <SheetClose asChild>
                <Link
                  href={SOKO_BOTS_ROUTE}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex min-h-auto w-full items-center gap-2.5 rounded-lg border px-3",
                    "group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:border-transparent group-data-[collapsible=icon]:px-0",
                    isActive
                      ? "border-transparent text-primary-foreground"
                      : "border-primary/50 hover:border-primary/70 text-tertiary-foreground dark:text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )}
                >
                  {bots.length > 0 ? (
                    <BotStack bots={bots} />
                  ) : (
                    <Bot className="size-4 shrink-0" aria-hidden />
                  )}
                  <span className="flex-1 truncate font-medium group-data-[collapsible=icon]:hidden">
                    {t("sokoBot")}
                  </span>
                </Link>
              </SheetClose>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
