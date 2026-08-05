"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useOptionalHistorySearch } from "@/app/components/history-search-dialog-provider";
import { cn } from "@/lib/utils";

import {
  CHAT_MOBILE_TABS,
  type ChatMobileTabId,
} from "./chat-mobile-tab-registry";

export function resolveChatMobileActiveTabId(
  pathname: string,
): Extract<ChatMobileTabId, "home" | "chats"> | null {
  for (const tab of CHAT_MOBILE_TABS) {
    if (tab.kind !== "link" || !tab.isActive(pathname)) {
      continue;
    }
    return tab.id;
  }
  return null;
}

export function ChatMobileBottomNav(): React.ReactElement {
  const pathname = usePathname();
  const t = useTranslations("App.Channels.MobileNav");
  // Optional: Instant Navigations / app Suspense fallback render this nav
  // before HistorySearchDialogProvider exists.
  const historySearch = useOptionalHistorySearch();
  const activeTabId = resolveChatMobileActiveTabId(pathname);

  return (
    <nav
      aria-label={t("ariaLabel")}
      className="border-border bg-background fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="flex h-16 items-stretch">
        {CHAT_MOBILE_TABS.map((tab) => {
          const Icon = tab.icon;
          const label = t(tab.labelKey);

          if (tab.kind === "search-action") {
            return (
              <li key={tab.id} className="flex min-w-0 flex-1">
                <button
                  type="button"
                  disabled={!historySearch}
                  onClick={() => {
                    historySearch?.openHistorySearch();
                  }}
                  className="text-muted-foreground hover:text-foreground flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-xs disabled:pointer-events-none disabled:opacity-50"
                >
                  <Icon className="size-5" aria-hidden />
                  <span className="truncate">{label}</span>
                </button>
              </li>
            );
          }

          const isActive = activeTabId === tab.id;

          return (
            <li key={tab.id} className="flex min-w-0 flex-1">
              <Link
                href={tab.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-xs",
                  isActive
                    ? "text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-5" aria-hidden />
                <span className="truncate">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
