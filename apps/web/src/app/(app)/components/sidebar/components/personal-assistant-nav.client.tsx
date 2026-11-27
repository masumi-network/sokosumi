"use client";

import { AnnouncedFeature, SokoBotStatus } from "@sokosumi/core-client";
import { avatarStateOf } from "@sokosumi/soko-bot";
import { Bot, Users } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { use } from "react";
import { SokoBotDirectRowContext } from "@/components/chat/personal-assistant-chrome-store";
import { useNavPathname } from "@/components/navigation-progress.client";
import { BotFace } from "@/components/soko-bot/bot-face";
import { SOKO_BOT_STATUS_TONE } from "@/components/soko-bot/soko-bot-badges";
import { SokoBotStatusLine } from "@/components/soko-bot/soko-bot-status-line";
import { STATUS_TONE_DOT_CLASS } from "@/components/soko-bot/status-badge";
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
import { SOKO_BOT_ROUTE } from "@/lib/soko-bot/constants";
import { cn } from "@/lib/utils";
import { isPathActive } from "@/lib/utils/is-path-active";

import {
  SIDEBAR_FEATURE_LABEL_CLASS,
  SidebarFeatureLabel,
} from "./sidebar-feature-label";
import { AGENTS_ROUTE } from "./sidebar-sections";
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
  nested = false,
}: {
  bot?: SidebarSokoBotLive | null;
  /**
   * Inside a section that is already a sidebar group (Direct messages): the
   * row takes that group's padding, so its slot stays on the Direct rows'.
   */
  nested?: boolean;
}) {
  // Session memory for Instant `/chat` (SOK-903): mount means the row is shown.
  usePersonalAssistantChromeVisible();
  // Your bot's Direct above stands in: no static row while the bot loads.
  const standsIn = use(SokoBotDirectRowContext) !== null;

  const menu = (
    <SidebarMenu className="gap-0">
      {bot ? (
        <LiveSokoBotRow bot={bot} />
      ) : standsIn ? null : (
        <StaticSokoBotsRow />
      )}
    </SidebarMenu>
  );
  if (nested) return menu;
  return (
    <SidebarGroup className="w-full">
      <SidebarGroupContent>{menu}</SidebarGroupContent>
    </SidebarGroup>
  );
}

function StaticSokoBotsRow() {
  const t = useTranslations("App.Sidebar.Content.MenuItems");
  const pathname = useNavPathname();
  const isActive = [AGENTS_ROUTE, SOKO_BOT_ROUTE].some((route) =>
    isPathActive(pathname, route),
  );

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive}>
        <SheetClose asChild>
          <Link
            href={AGENTS_ROUTE}
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
 * bot; the people icon at the end opens the Agents page for the team's bots.
 */
function LiveSokoBotRow({ bot: rendered }: { bot: SidebarSokoBotLive }) {
  const bot = useLiveSokoBot(rendered);
  const t = useTranslations("App.Sidebar.Content.SokoBot");
  const pathname = useNavPathname();
  const isActive = isPathActive(pathname, SOKO_BOT_ROUTE);
  const isTeamActive = !isActive && isPathActive(pathname, AGENTS_ROUTE);

  // The Direct above is this bot's row now; this one keeps polling for it.
  if (use(SokoBotDirectRowContext) === bot.id) return null;

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
              <SokoBotStatusLine bot={bot} />
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
            href={AGENTS_ROUTE}
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
