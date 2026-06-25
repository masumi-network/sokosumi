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
 * The Personal Assistant — the headline destination, sitting at the very top
 * of the sidebar above "New". Framed as a bordered "featured button" (the only
 * outlined row) so it reads as distinct without a permanent fill that would
 * make it look perpetually selected. The live orb carries its identity, and
 * the label becomes the assistant's chosen name once it has one.
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
    <SidebarGroup className="w-full pt-2">
      <SidebarGroupContent>
        <SidebarMenu className="gap-0">
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={isActive} className="h-auto">
              <SheetClose asChild>
                <Link
                  href={href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex min-h-auto w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 font-medium transition-colors",
                    isActive
                      ? "border-transparent text-primary-foreground"
                      : "border-border/70 text-foreground hover:border-border hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )}
                >
                  {/* The live agent: chosen orb once a colour is committed,
                      else the white placeholder — always with its eyes. */}
                  <AssistantOrb
                    seed={avatarSeed}
                    size={56}
                    expression="idle"
                    className="size-6 shrink-0"
                  />
                  <span className="flex-1 truncate">{label}</span>
                  {showUnread ? (
                    <span
                      aria-label={`${unreadDisplay} unread`}
                      className={cn(
                        "inline-flex min-w-4.5 shrink-0 items-center justify-center rounded-full px-1 text-xs font-semibold leading-4 tabular-nums",
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
