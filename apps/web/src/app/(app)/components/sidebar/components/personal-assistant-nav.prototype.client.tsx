"use client";

/**
 * PROTOTYPE, throwaway: the Soko Bot entry with your bot's live state, for
 * sidebar variants b (row) and c (card). See `sidebar-prototype.client.tsx`.
 * Copy is hard-coded English until a variant wins.
 */

import { SokoBotStatus } from "@sokosumi/core-client";
import { Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CHAT_COMPOSE_PLUS_TRIGGER_CLASSNAME } from "@/app/chat/components/chat-compose-dialog";
import { AuroraOrb } from "@/components/aurora-orb";
import { useSidebarPrototypeVariant } from "@/components/prototype/sidebar-prototype.client";
import { SheetClose } from "@/components/ui/sheet";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRailSelectionBar,
} from "@/components/ui/sidebar";
import { SOKO_BOT_ROUTE, SOKO_BOTS_ROUTE } from "@/lib/soko-bot/constants";
import { cn } from "@/lib/utils";

import PersonalAssistantNav, {
  type SidebarSokoBotAvatar,
} from "./personal-assistant-nav.client";

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

function lastActiveLabel(lastActivityAt: Date | null): string {
  if (!lastActivityAt) {
    return "Ready";
  }
  const minutes = Math.round(
    (new Date(lastActivityAt).getTime() - Date.now()) / 60_000,
  );
  const format = new Intl.RelativeTimeFormat(undefined, {
    numeric: "auto",
    style: "narrow",
  });
  if (Math.abs(minutes) < 60) {
    return `Active ${format.format(minutes, "minute")}`;
  }
  if (Math.abs(minutes) < 60 * 24) {
    return `Active ${format.format(Math.round(minutes / 60), "hour")}`;
  }
  return `Active ${format.format(Math.round(minutes / 1440), "day")}`;
}

function statusLine(bot: SidebarSokoBotLive) {
  switch (bot.status) {
    case SokoBotStatus.RUNNING:
      return { text: "Working now", className: "text-status-working" };
    case SokoBotStatus.PAUSED:
      return { text: "Paused", className: "text-muted-foreground" };
    case SokoBotStatus.ERROR:
      return {
        text: "Needs attention",
        className: "text-semantic-destructive",
      };
    default:
      return {
        text: lastActiveLabel(bot.lastActivityAt),
        className: "text-muted-foreground",
      };
  }
}

function LiveFace({ bot }: { bot: SidebarSokoBotLive }) {
  return (
    <span className="relative flex size-7 shrink-0 items-center justify-center group-data-[collapsible=icon]:size-5">
      {bot.status === SokoBotStatus.RUNNING ? (
        <span
          aria-hidden
          className="border-status-working absolute inset-0 rounded-full border-2 motion-safe:animate-ping"
        />
      ) : null}
      {bot.imageUrl ? (
        <img
          src={bot.imageUrl}
          alt=""
          aria-hidden
          className="size-full rounded-full object-cover"
        />
      ) : (
        <AuroraOrb
          seed={bot.seed}
          size={56}
          className="size-full rounded-full object-cover"
        />
      )}
      <span
        aria-hidden
        className={cn(
          "ring-sidebar absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2",
          STATUS_DOT_CLASS[bot.status],
        )}
      />
    </span>
  );
}

export function SokoBotLiveNav({ bot }: { bot: SidebarSokoBotLive | null }) {
  const variant = useSidebarPrototypeVariant();
  const pathname = usePathname();

  if (!bot) {
    return <PersonalAssistantNav />;
  }

  const card = variant === "c";
  const href = bot.isYours ? SOKO_BOT_ROUTE : SOKO_BOTS_ROUTE;
  const isActive = pathname === href || pathname.startsWith(`${href}/`);
  const name = bot.name ?? "Soko Bot";
  const line = statusLine(bot);

  return (
    <SidebarGroup className="w-full py-2">
      <SidebarGroupContent
        className={cn(
          card &&
            "bg-sidebar-accent rounded-lg p-1 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:p-0",
        )}
      >
        <SidebarMenu className="gap-0">
          <SidebarMenuItem className="relative">
            <SidebarMenuButton
              asChild
              isActive={isActive}
              tooltip={`${name} · ${line.text}`}
              className="h-auto py-1.5 md:h-auto group-data-[collapsible=icon]:h-8! group-data-[collapsible=icon]:py-0"
            >
              <SheetClose asChild>
                <Link
                  href={href}
                  aria-current={isActive ? "page" : undefined}
                  className="text-sidebar-foreground hover:text-sidebar-accent-foreground"
                >
                  <LiveFace bot={bot} />
                  <span className="flex min-w-0 flex-1 flex-col leading-tight group-data-[collapsible=icon]:hidden">
                    <span className="truncate text-sm font-medium">{name}</span>
                    <span className={cn("truncate text-xs", line.className)}>
                      {line.text}
                    </span>
                  </span>
                  {card ? null : (
                    <span
                      aria-hidden
                      className="w-7 shrink-0 group-data-[collapsible=icon]:hidden"
                    />
                  )}
                </Link>
              </SheetClose>
            </SidebarMenuButton>
            {card ? null : (
              <div className="absolute top-1/2 right-1 z-10 -translate-y-1/2 group-data-[collapsible=icon]:hidden">
                <SheetClose asChild>
                  <Link
                    href={SOKO_BOTS_ROUTE}
                    aria-label="Your team’s Soko Bots"
                    title="Your team’s Soko Bots"
                    className={CHAT_COMPOSE_PLUS_TRIGGER_CLASSNAME}
                  >
                    <Users className="size-4 md:size-3.5" aria-hidden />
                  </Link>
                </SheetClose>
              </div>
            )}
            {isActive ? <SidebarRailSelectionBar /> : null}
          </SidebarMenuItem>
        </SidebarMenu>
        {card ? (
          <div className="border-sidebar-border text-muted-foreground mx-2 mt-1 flex items-center justify-between border-t pt-1.5 pb-0.5 text-xs group-data-[collapsible=icon]:hidden">
            <span>Your Soko Bot</span>
            <SheetClose asChild>
              <Link
                href={SOKO_BOTS_ROUTE}
                className="hover:text-sidebar-accent-foreground rounded-sm"
              >
                Team’s bots →
              </Link>
            </SheetClose>
          </div>
        ) : null}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
