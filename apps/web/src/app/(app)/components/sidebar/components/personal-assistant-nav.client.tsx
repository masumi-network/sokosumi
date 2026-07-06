"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { AssistantOrb } from "@/components/aurora-orb";
import { SheetClose } from "@/components/ui/sheet";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { getHermesUnreadCountAction } from "@/lib/actions/hermes";
import { cn } from "@/lib/utils";

interface PersonalAssistantNavProps {
  /** Gated by `hermesBetaEnabled` in the app layout. */
  enabled: boolean;
}

const UNREAD_POLL_INTERVAL_MS = 30_000;

interface AssistantNavState {
  count: number;
  /** The chosen orb seed, or null until the user picks one. */
  avatarSeed: string | null;
  /** The chosen assistant name, or null until the user names it. */
  assistantName: string | null;
}

/**
 * Polls the lightweight unread-count endpoint, which also carries the chosen
 * orb seed — so the sidebar shows the user's orb (and reacts after they pick
 * one) without a heavier instance fetch.
 */
function useAssistantNavState(enabled: boolean): AssistantNavState {
  const [state, setState] = useState<AssistantNavState>({
    count: 0,
    avatarSeed: null,
    assistantName: null,
  });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        return;
      }
      const result = await getHermesUnreadCountAction({});
      if (cancelled || !result.ok) return;
      setState(result.data);
    };

    void tick();
    const interval = setInterval(() => void tick(), UNREAD_POLL_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled]);

  return enabled ? state : { count: 0, avatarSeed: null, assistantName: null };
}

/**
 * The Personal Assistant — a normal nav item at the very top of the sidebar,
 * set apart from "New" by a divider (rendered in the sidebar composition). Its
 * live orb carries its identity, and the label becomes the assistant's chosen
 * name once it has one.
 */
export default function PersonalAssistantNav({
  enabled,
}: PersonalAssistantNavProps) {
  const t = useTranslations("App.Sidebar.Content.MenuItems");
  const pathname = usePathname();
  const {
    count: unread,
    avatarSeed,
    assistantName,
  } = useAssistantNavState(enabled);

  if (!enabled) return null;

  const href = "/hermes";
  const isActive = pathname === href || pathname.startsWith(`${href}/`);
  const showUnread = unread > 0;
  const unreadDisplay = unread > 99 ? "99+" : String(unread);
  // Once the user names the assistant, the nav shows the name instead of the
  // generic "Personal Assistant" label.
  const label = assistantName?.trim() || t("hermes");

  return (
    <SidebarGroup className="w-full">
      <SidebarGroupContent>
        <SidebarMenu className="gap-0">
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={isActive} size="lg">
              <SheetClose asChild>
                <Link
                  href={href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex min-h-auto w-full items-center gap-2.5 rounded-lg border px-3",
                    "group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:border-transparent group-data-[collapsible=icon]:px-0",
                    isActive
                      ? "border-transparent text-primary-foreground"
                      : "border-sidebar-border text-tertiary-foreground dark:text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )}
                >
                  {/* The live agent: chosen orb once a colour is committed,
                      else the white placeholder — always with its eyes.
                      Deliberately larger than the 16px nav icons and ringed
                      like the avatars elsewhere in the app — this is an
                      identity, not another icon glyph, and the row (bordered
                      card, taller, bold label) is styled to match. Collapses
                      back to the compact icon-sized treatment in icon mode,
                      where there's no room for the bigger card (the orb is a
                      canvas, so the button's `[&>svg]:size-4` rule doesn't
                      reach it). */}
                  <AssistantOrb
                    seed={avatarSeed}
                    size={48}
                    expression="idle"
                    className="ring-border size-7 shrink-0 ring-2 group-data-[collapsible=icon]:size-4 group-data-[collapsible=icon]:ring-1"
                  />
                  <span className="flex-1 truncate font-medium group-data-[collapsible=icon]:hidden">
                    {label}
                  </span>
                  {showUnread ? (
                    <span
                      aria-label={`${unreadDisplay} unread`}
                      className={cn(
                        "inline-flex min-w-4.5 shrink-0 items-center justify-center rounded-full px-1 text-xs font-semibold leading-4 tabular-nums",
                        "group-data-[collapsible=icon]:hidden",
                        isActive
                          ? "bg-primary-foreground text-primary"
                          : "bg-primary text-primary-foreground",
                      )}
                    >
                      {unreadDisplay}
                    </span>
                  ) : null}
                </Link>
              </SheetClose>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
