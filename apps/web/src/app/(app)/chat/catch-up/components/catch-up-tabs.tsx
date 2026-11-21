"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { useTranslations } from "next-intl";

import {
  CHAT_CATCH_UP_PATH,
  CHAT_DECISIONS_PATH,
  CHAT_SAVED_PATH,
} from "@/app/chat/utils/chat-route-base";
import {
  SEGMENTED_TAB_TRIGGER_CLASS_NAME,
  SEGMENTED_TABS_LIST_CLASS_NAME,
} from "@/components/ui/tabs-classes";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "overview", segment: null, href: CHAT_CATCH_UP_PATH },
  { id: "threads", segment: "threads", href: `${CHAT_CATCH_UP_PATH}/threads` },
  { id: "decisions", segment: "decisions", href: CHAT_DECISIONS_PATH },
  { id: "saved", segment: "saved", href: CHAT_SAVED_PATH },
] as const;

/**
 * Catch up's tabs, in its layout so they stay put while a tab's page loads
 * below them. The open tab is the layout's selected segment.
 */
export function CatchUpTabs() {
  const t = useTranslations("App.Channels.Signals.CatchUpTabs");
  const segment = useSelectedLayoutSegment();
  return (
    // Links, not Radix tabs: each tab is its own route. They wear the shared
    // segmented-tab classes, which key the active look on `data-state`.
    <nav
      aria-label={t("label")}
      className={cn(SEGMENTED_TABS_LIST_CLASS_NAME, "mb-4 w-auto")}
    >
      {TABS.map((tab) => {
        const active = tab.segment === segment;
        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            data-state={active ? "active" : "inactive"}
            className={cn(
              SEGMENTED_TAB_TRIGGER_CLASS_NAME,
              "focus-visible:ring-ring outline-none focus-visible:ring-2",
            )}
          >
            {t(tab.id)}
          </Link>
        );
      })}
    </nav>
  );
}
