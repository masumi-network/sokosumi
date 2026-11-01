"use client";

import {
  AnnouncedFeature,
  SokoBotAvatarState,
  type SokoBotAvatarView,
  SokoBotStatus,
} from "@sokosumi/core-client";
import { Bot, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFormatter, useNow, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { AuroraOrb } from "@/components/aurora-orb";
import { publishPersonalAssistantChromeVisible } from "@/components/chat/personal-assistant-chrome-store";
import { AvatarFace } from "@/components/soko-bot/avatar-face";
import { AvatarLoop } from "@/components/soko-bot/avatar-loop";
import {
  AvatarStateLine,
  AvatarStatePill,
  useAvatarStateCopy,
  usePlayOnce,
} from "@/components/soko-bot/avatar-state";
import {
  STATUS_TONE_DOT_CLASS,
  type StatusTone,
  statusToneTextClass,
} from "@/components/soko-bot/status-badge";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
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
import { useMountEffect } from "@/hooks/use-mount-effect";
import { avatarSources } from "@/lib/soko-bot/avatar";
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
  seed: string;
}

/** Your own Soko Bot, live. */
export interface SidebarSokoBotLive extends SidebarSokoBotAvatar {
  name: string | null;
  status: SokoBotStatus;
  lastActivityAt: Date | null;
  avatarState: SokoBotAvatarState;
  /** Stills and loops of a crafted avatar; null for a mascot or an orb. */
  avatar: SokoBotAvatarView | null;
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
  const pathname = usePathname();
  const isActive = isPathActive(pathname, SOKO_BOT_ROUTE);
  const isTeamActive = !isActive && isPathActive(pathname, SOKO_BOTS_ROUTE);

  return (
    <SidebarMenuItem className="relative">
      {/* The hover and selection fill stay on this one element and cover
          both lines. */}
      {/* Hover or keyboard focus opens the card; Radix mounts its content only
          while open, so the loop inside runs only while it is. */}
      <HoverCard openDelay={200} closeDelay={100}>
        <SidebarMenuButton asChild isActive={isActive} lines={2}>
          <SheetClose asChild>
            <HoverCardTrigger asChild>
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
                  className={cn(
                    SIDEBAR_ROW_LABEL_CLASS,
                    "flex flex-col gap-0.5",
                  )}
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
            </HoverCardTrigger>
          </SheetClose>
        </SidebarMenuButton>
        <BotHoverCard bot={bot} />
      </HoverCard>
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

const AVATAR_STATE_TONE: Record<SokoBotAvatarState, StatusTone> = {
  [SokoBotAvatarState.IDLE]: "neutral",
  [SokoBotAvatarState.THINKING]: "working",
  [SokoBotAvatarState.WORKING]: "working",
  [SokoBotAvatarState.DONE]: "success",
  [SokoBotAvatarState.NEEDS_YOU]: "warning",
  [SokoBotAvatarState.OFFLINE]: "neutral",
};

/**
 * The words and tone for the row. An idle bot whose last turn failed says so:
 * the avatar state calls that idle, and the error must not go quiet.
 */
function rowStatus(bot: SidebarSokoBotLive) {
  const failing =
    bot.status === SokoBotStatus.ERROR &&
    bot.avatarState === SokoBotAvatarState.IDLE;
  return {
    failing,
    tone: failing ? "danger" : AVATAR_STATE_TONE[bot.avatarState],
  } as const;
}

/**
 * What the bot is doing, in the tone of its avatar state: the state's word
 * (Thinking, Working, Done, Needs you, Offline), and for an idle bot when it
 * was last active.
 */
function StatusLine({ bot }: { bot: SidebarSokoBotLive }) {
  const t = useTranslations("App.Sidebar.Content.SokoBot");
  const { label } = useAvatarStateCopy();
  const { failing, tone } = rowStatus(bot);
  let content: ReactNode;
  if (failing) content = t("needsAttention");
  else if (bot.avatarState !== SokoBotAvatarState.IDLE)
    content = label(bot.avatarState);
  else if (bot.lastActivityAt) content = <LastActive at={bot.lastActivityAt} />;
  else content = t("ready");

  return (
    <span
      data-slot="soko-bot-status-line"
      className={cn(
        "truncate text-xs leading-tight",
        statusToneTextClass(tone),
      )}
    >
      {content}
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
 * as one column. A dot at its corner says the state at a glance.
 */
function LiveBotFace({ bot }: { bot: SidebarSokoBotLive }) {
  const faceClass = "size-5 shrink-0 rounded-full object-cover";
  // A state change plays once on the small face, then it rests on the still.
  const [playing, stop] = usePlayOnce(bot.avatarState, false);
  const sources = avatarSources(bot.avatar, bot.avatarState, bot.imageUrl);

  return (
    <span className="relative flex size-5 shrink-0">
      {sources.still ? (
        <AvatarFace
          src={sources.still}
          crafted={sources.crafted}
          className={faceClass}
          loopSrc={sources.loop}
          playing={playing}
          onEnded={stop}
        />
      ) : (
        <AuroraOrb seed={bot.seed} size={40} className={faceClass} />
      )}
      <span
        aria-hidden
        data-slot="soko-bot-status-dot"
        className={cn(
          "ring-sidebar absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2",
          STATUS_TONE_DOT_CLASS[rowStatus(bot).tone],
        )}
      />
    </span>
  );
}

/** The bot's picture, name, state and what it is doing, beside its row. */
function BotHoverCard({ bot }: { bot: SidebarSokoBotLive }) {
  const t = useTranslations("App.Sidebar.Content.SokoBot");
  const { alt } = useAvatarStateCopy();
  const sources = avatarSources(bot.avatar, bot.avatarState, bot.imageUrl);
  const name = bot.name ?? t("fallbackName");

  return (
    <HoverCardContent
      side="right"
      align="start"
      className="flex w-66 flex-col gap-3 p-3"
    >
      {sources.still ? (
        // The card exists only while open, so it loops for as long as it does.
        <AvatarLoop
          poster={sources.still}
          src={sources.loop}
          playing
          loop
          alt={alt(name, bot.avatarState)}
          className="bg-muted size-60 rounded-lg object-cover"
        />
      ) : (
        <AuroraOrb
          seed={bot.seed}
          size={480}
          alt={alt(name, bot.avatarState)}
          className="size-60 rounded-lg"
        />
      )}
      <div className="flex flex-col gap-1.5 px-0.5 pb-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold">{name}</span>
          <AvatarStatePill state={bot.avatarState} />
        </div>
        <span className="text-muted-foreground text-xs">
          <AvatarStateLine
            state={bot.avatarState}
            lastActivityAt={bot.lastActivityAt}
          />
        </span>
      </div>
    </HoverCardContent>
  );
}
