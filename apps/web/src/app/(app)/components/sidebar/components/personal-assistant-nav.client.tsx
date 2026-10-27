"use client";

import { AnnouncedFeature, SokoBotStatus } from "@sokosumi/core-client";
import { Bot, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFormatter, useNow, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { CHAT_COMPOSE_PLUS_TRIGGER_CLASSNAME } from "@/app/chat/components/chat-compose-dialog";
import { AuroraOrb } from "@/components/aurora-orb";
import { publishPersonalAssistantChromeVisible } from "@/components/chat/personal-assistant-chrome-store";
import { SheetClose } from "@/components/ui/sheet";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRowSlot,
} from "@/components/ui/sidebar";
import { SIDEBAR_ROW_LABEL_CLASS } from "@/components/ui/sidebar-classes";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { SOKO_BOT_ROUTE, SOKO_BOTS_ROUTE } from "@/lib/soko-bot/constants";
import { cn } from "@/lib/utils";

import {
  SIDEBAR_FEATURE_LABEL_CLASS,
  SidebarFeatureLabel,
} from "./sidebar-feature-label";

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

/** The workspace's first Soko Bot (yours when you have one), live. */
export interface SidebarSokoBotLive extends SidebarSokoBotAvatar {
  name: string | null;
  status: SokoBotStatus;
  lastActivityAt: Date | null;
  isYours: boolean;
}

const STATUS_DOT_CLASS: Record<SokoBotStatus, string> = {
  [SokoBotStatus.RUNNING]: "bg-status-working",
  [SokoBotStatus.IDLE]: "bg-semantic-success",
  [SokoBotStatus.PAUSED]: "bg-muted-foreground",
  [SokoBotStatus.ERROR]: "bg-semantic-destructive",
};

const ROW_LINK_CLASS =
  "text-tertiary-foreground dark:text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";

function isOnRoute(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

/**
 * With the team's bot data, a live two-line row; without it (loading, no bot
 * in the workspace, Core unreachable), the static Soko Bots entry.
 */
export default function PersonalAssistantNav({
  bot = null,
}: {
  bot?: SidebarSokoBotLive | null;
}) {
  useMountEffect(() => {
    // Session memory for Instant `/chat` (SOK-903): mount means the row is shown.
    publishPersonalAssistantChromeVisible(true);
  });

  return (
    <SidebarGroup className="w-full">
      <SidebarGroupContent>
        <SidebarMenu className="gap-0">
          {bot ? <LiveSokoBotRow bot={bot} /> : <StaticSokoBotsRow />}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function StaticSokoBotsRow() {
  const t = useTranslations("App.Sidebar.Content.MenuItems");
  const pathname = usePathname();
  const isActive = [SOKO_BOTS_ROUTE, SOKO_BOT_ROUTE].some((route) =>
    isOnRoute(pathname, route),
  );

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive}>
        <SheetClose asChild>
          <Link
            href={SOKO_BOTS_ROUTE}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              isActive ? "text-sidebar-accent-foreground" : ROW_LINK_CLASS,
            )}
          >
            <SidebarRowSlot>
              <Bot aria-hidden />
            </SidebarRowSlot>
            <span
              className={cn(
                SIDEBAR_ROW_LABEL_CLASS,
                SIDEBAR_FEATURE_LABEL_CLASS,
                "font-medium",
              )}
            >
              <SidebarFeatureLabel
                label={t("sokoBot")}
                feature={AnnouncedFeature.SOKO_BOTS}
              />
            </span>
          </Link>
        </SheetClose>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/**
 * Face with a status dot, the bot's name, and what it is doing. Opens your
 * own bot, or the team's page when the bot is a teammate's. The people icon
 * at the end always opens the team's Soko Bots.
 */
function LiveSokoBotRow({ bot }: { bot: SidebarSokoBotLive }) {
  const t = useTranslations("App.Sidebar.Content.SokoBot");
  const pathname = usePathname();
  const href = bot.isYours ? SOKO_BOT_ROUTE : SOKO_BOTS_ROUTE;
  const isActive = isOnRoute(pathname, href);
  const isTeamActive = !isActive && isOnRoute(pathname, SOKO_BOTS_ROUTE);

  return (
    <SidebarMenuItem className="relative">
      {/* Two lines, so the row releases the one-line height and keeps the
          primitive's floor; the hover and selection fill stay on this one
          element and cover both. */}
      <SidebarMenuButton
        asChild
        isActive={isActive}
        className="h-auto py-1 md:h-auto"
        data-row-lines="2"
      >
        <SheetClose asChild>
          <Link
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              isActive ? "text-sidebar-accent-foreground" : ROW_LINK_CLASS,
            )}
          >
            <SidebarRowSlot>
              <LiveBotFace bot={bot} />
            </SidebarRowSlot>
            <span
              className={cn(SIDEBAR_ROW_LABEL_CLASS, "flex flex-col gap-0.5")}
            >
              <span
                className={cn(
                  SIDEBAR_FEATURE_LABEL_CLASS,
                  "font-medium leading-tight",
                )}
              >
                <SidebarFeatureLabel
                  label={bot.name ?? t("fallbackName")}
                  feature={AnnouncedFeature.SOKO_BOTS}
                />
              </span>
              <span className="sr-only">, </span>
              <StatusLine bot={bot} />
            </span>
            {/* Holds the label clear of the team link drawn over the end. */}
            <span aria-hidden className="w-7 shrink-0" />
          </Link>
        </SheetClose>
      </SidebarMenuButton>
      <div className="absolute top-1/2 right-1 z-10 -translate-y-1/2">
        <SheetClose asChild>
          <Link
            href={SOKO_BOTS_ROUTE}
            aria-label={t("team")}
            aria-current={isTeamActive ? "page" : undefined}
            title={t("team")}
            className={CHAT_COMPOSE_PLUS_TRIGGER_CLASSNAME}
          >
            <Users className="size-4 md:size-3.5" aria-hidden />
          </Link>
        </SheetClose>
      </div>
    </SidebarMenuItem>
  );
}

function StatusLine({ bot }: { bot: SidebarSokoBotLive }) {
  const t = useTranslations("App.Sidebar.Content.SokoBot");
  let text: ReactNode;
  let className = "text-muted-foreground";

  switch (bot.status) {
    case SokoBotStatus.RUNNING:
      text = t("workingNow");
      className = "text-status-working";
      break;
    case SokoBotStatus.PAUSED:
      text = t("paused");
      break;
    case SokoBotStatus.ERROR:
      text = t("needsAttention");
      className = "text-semantic-destructive";
      break;
    default:
      text = bot.lastActivityAt ? (
        <LastActive at={bot.lastActivityAt} />
      ) : (
        t("ready")
      );
  }

  return (
    <span className={cn("truncate text-xs leading-tight", className)}>
      {text}
    </span>
  );
}

/** "Active 2h ago", narrow, in the reader's locale; ticks once a minute. */
function LastActive({ at }: { at: Date }) {
  const t = useTranslations("App.Sidebar.Content.SokoBot");
  const formatter = useFormatter();
  const now = useNow({ updateInterval: 60_000 });

  return t("activeAgo", {
    time: formatter.relativeTime(at, { now, style: "narrow" }),
  });
}

/**
 * 20px, the size every face in this sidebar is: this row stands directly
 * above the chat lists, so a face here and a Direct's face below it are read
 * as one column. A dot at its corner says the status at a glance; a running
 * bot also pulses, still under reduced motion.
 */
function LiveBotFace({ bot }: { bot: SidebarSokoBotLive }) {
  const faceClass = "size-5 shrink-0 rounded-full object-cover";

  return (
    <span className="relative flex size-5 shrink-0">
      {bot.status === SokoBotStatus.RUNNING ? (
        <span
          aria-hidden
          data-testid="soko-bot-pulse"
          className="border-status-working absolute inset-0 rounded-full border-2 motion-safe:animate-ping"
        />
      ) : null}
      {bot.imageUrl ? (
        <img src={bot.imageUrl} alt="" className={faceClass} aria-hidden />
      ) : (
        <AuroraOrb seed={bot.seed} size={40} className={faceClass} />
      )}
      <span
        aria-hidden
        className={cn(
          "ring-sidebar absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2",
          STATUS_DOT_CLASS[bot.status],
        )}
      />
    </span>
  );
}
