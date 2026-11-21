"use client";

import { AnnouncedFeature, SokoBotStatus } from "@sokosumi/core-client";
import { avatarStateOf } from "@sokosumi/soko-bot";
import { Bot, Users } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { type ReactNode, Suspense, use } from "react";
import { browser } from "react-dom";
import { useNavPathname } from "@/components/navigation-progress.client";
import {
  useFormatShortTimeAgo,
  useSharedNow,
} from "@/components/short-time-ago";
import { BotFace } from "@/components/soko-bot/bot-face";
import { SOKO_BOT_STATUS_TONE } from "@/components/soko-bot/soko-bot-badges";
import {
  STATUS_TONE_DOT_CLASS,
  statusToneTextClass,
} from "@/components/soko-bot/status-badge";
import { SheetClose } from "@/components/ui/sheet";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRowSlot,
} from "@/components/ui/sidebar";
import {
  SIDEBAR_ICON_ACTION_CLASS,
  SIDEBAR_ROW_HOVER_REVEAL_CLASS,
  SIDEBAR_ROW_LABEL_CLASS,
  SIDEBAR_ROW_LINK_CLASS,
} from "@/components/ui/sidebar-classes";
import { usePersonalAssistantChromeVisible } from "@/hooks/effects/use-personal-assistant-chrome-visible";
import { SOKO_BOT_ROUTE, SOKO_BOTS_ROUTE } from "@/lib/soko-bot/constants";
import { cn } from "@/lib/utils";
import { isPathActive } from "@/lib/utils/is-path-active";

import {
  SIDEBAR_FEATURE_LABEL_CLASS,
  SidebarFeatureLabel,
} from "./sidebar-feature-label";
import { useLiveSokoBot } from "./use-live-soko-bot";

/**
 * Soko Bots entry at the top of the sidebar: the team chart of everyone's
 * assistants, and where a person creates their own. Set apart from the rest
 * of the nav by a divider rendered in the sidebar composition.
 */
export interface SidebarSokoBotAvatar {
  id: string;
  imageUrl: string | null;
  avatarCode?: string | null;
  seed: string;
}

/** Your own Soko Bot, live. */
export interface SidebarSokoBotLive extends SidebarSokoBotAvatar {
  name: string | null;
  status: SokoBotStatus;
  lastActivityAt: Date | null;
}

/**
 * With your bot, a live two-line row; without it (loading, no bot of your
 * own, Core unreachable), the static Soko Bots entry.
 */
export default function PersonalAssistantNav({
  bot = null,
}: {
  bot?: SidebarSokoBotLive | null;
}) {
  // Session memory for Instant `/chat` (SOK-903): mount means the row is shown.
  usePersonalAssistantChromeVisible();

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
  const pathname = useNavPathname();
  const isActive = [SOKO_BOTS_ROUTE, SOKO_BOT_ROUTE].some((route) =>
    isPathActive(pathname, route),
  );

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive}>
        <SheetClose asChild>
          <Link
            href={SOKO_BOTS_ROUTE}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              isActive
                ? "text-sidebar-accent-foreground"
                : SIDEBAR_ROW_LINK_CLASS,
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
 * bot; the people icon at the end opens the team's Soko Bots.
 */
function LiveSokoBotRow({ bot: rendered }: { bot: SidebarSokoBotLive }) {
  const bot = useLiveSokoBot(rendered);
  const t = useTranslations("App.Sidebar.Content.SokoBot");
  const pathname = useNavPathname();
  const isActive = isPathActive(pathname, SOKO_BOT_ROUTE);
  const isTeamActive = !isActive && isPathActive(pathname, SOKO_BOTS_ROUTE);

  return (
    <SidebarMenuItem className="relative">
      {/* The hover and selection fill stay on this one element and cover
          both lines. */}
      <SidebarMenuButton asChild isActive={isActive} lines={2}>
        <SheetClose asChild>
          <Link
            href={SOKO_BOT_ROUTE}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              isActive
                ? "text-sidebar-accent-foreground"
                : SIDEBAR_ROW_LINK_CLASS,
            )}
          >
            <SidebarRowSlot>
              <LiveBotFace bot={bot} />
            </SidebarRowSlot>
            <span
              className={cn(SIDEBAR_ROW_LABEL_CLASS, "flex flex-col gap-0.5")}
            >
              <span
                className={cn(SIDEBAR_FEATURE_LABEL_CLASS, "leading-tight")}
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
      <div
        className={cn(
          "absolute top-1/2 right-1 z-10 -translate-y-1/2",
          !isTeamActive && SIDEBAR_ROW_HOVER_REVEAL_CLASS,
        )}
      >
        <SheetClose asChild>
          <Link
            href={SOKO_BOTS_ROUTE}
            aria-label={t("team")}
            aria-current={isTeamActive ? "page" : undefined}
            title={t("team")}
            className={SIDEBAR_ICON_ACTION_CLASS}
          >
            <Users className="size-4 md:size-3.5" aria-hidden />
          </Link>
        </SheetClose>
      </div>
    </SidebarMenuItem>
  );
}

/**
 * What the bot is doing, in the tone the Soko Bot status badge paints it.
 * The words are the sidebar's where a row says more than the badge's one
 * word ("Working now", when an idle bot was last active), and the badge's
 * own where they agree ("Paused", "Couldn't reply"): a failed reply reads the
 * same here, on the bot's page and on its Direct in the chat list.
 */
function StatusLine({ bot }: { bot: SidebarSokoBotLive }) {
  const t = useTranslations("App.Sidebar.Content.SokoBot");
  const tStatus = useTranslations("Components.SokoBot.BotStatus");
  const text: Record<SokoBotStatus, ReactNode> = {
    [SokoBotStatus.RUNNING]: t("workingNow"),
    [SokoBotStatus.PAUSED]: tStatus(SokoBotStatus.PAUSED),
    [SokoBotStatus.ERROR]: tStatus(SokoBotStatus.ERROR),
    [SokoBotStatus.IDLE]: bot.lastActivityAt ? (
      <LastActive at={bot.lastActivityAt} />
    ) : (
      t("ready")
    ),
  };

  return (
    <span
      data-slot="soko-bot-status-line"
      className={cn(
        "truncate text-xs leading-tight",
        statusToneTextClass(SOKO_BOT_STATUS_TONE[bot.status]),
      )}
    >
      {text[bot.status]}
    </span>
  );
}

/**
 * "Active 2h ago", in the short form Home's rows use and on their clock. The
 * server sends the time of day instead ("Active 9:34 PM"): its clock and the
 * browser's differ by the load, so a relative label from each would not
 * hydrate (React #418), and a date as well would not fit the row.
 */
export function LastActive({ at }: { at: Date }) {
  const t = useTranslations("App.Sidebar.Content.SokoBot");
  const formatter = useFormatter();

  return (
    <Suspense
      fallback={t("activeAgo", { time: formatter.dateTime(at, "time") })}
    >
      <LastActiveRelative at={at} />
    </Suspense>
  );
}

function LastActiveRelative({ at }: { at: Date }) {
  use(browser());
  const t = useTranslations("App.Sidebar.Content.SokoBot");
  const formatShortTimeAgo = useFormatShortTimeAgo();

  return t("activeAgo", { time: formatShortTimeAgo(at, useSharedNow()) });
}

/**
 * 20px, the size every face in this sidebar is: this row stands directly
 * above the chat lists, so a face here and a Direct's face below it are read
 * as one column. A dot at its corner says the status at a glance; a running
 * bot also pulses, still under reduced motion.
 */
function LiveBotFace({ bot }: { bot: SidebarSokoBotLive }) {
  return (
    <span className="relative flex size-5 shrink-0">
      {bot.status === SokoBotStatus.RUNNING ? (
        <span
          aria-hidden
          data-testid="soko-bot-pulse"
          className="bg-status-working absolute inset-0 rounded-full motion-safe:animate-ping"
        />
      ) : null}
      <BotFace
        imageUrl={bot.imageUrl}
        seed={bot.seed}
        orbSize={40}
        avatarCode={bot.avatarCode}
        // The poll knows the bot's status, not its turn: running reads as working.
        avatarState={avatarStateOf({ status: bot.status })}
        avatarSize={20}
        className="size-5"
      />
      <span
        aria-hidden
        data-slot="soko-bot-status-dot"
        className={cn(
          "ring-sidebar absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2",
          STATUS_TONE_DOT_CLASS[SOKO_BOT_STATUS_TONE[bot.status]],
        )}
      />
    </span>
  );
}
