"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useOptionalHistorySearch } from "@/app/components/history-search-dialog-provider";
import useIsApplePlatform from "@/hooks/use-is-apple-platform";
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
  const isApple = useIsApplePlatform();

  return (
    <nav
      aria-label={t("ariaLabel")}
      className={cn(
        "z-40 md:hidden",
        isApple
          ? "bg-background/45 fixed inset-x-4 bottom-[max(0.75rem,env(safe-area-inset-bottom))] rounded-full border border-border/40 shadow-lg shadow-black/10 backdrop-blur-2xl backdrop-saturate-150 dark:bg-background/35 dark:shadow-black/40"
          : "border-border bg-background fixed inset-x-0 bottom-0 border-t pb-[env(safe-area-inset-bottom)]",
      )}
    >
      <ul
        className={cn(
          "flex items-stretch",
          isApple ? "h-16 gap-0.5 px-1.5 py-1.5" : "h-16",
        )}
      >
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
                  className={cn(
                    "text-muted-foreground hover:text-foreground flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-xs disabled:pointer-events-none disabled:opacity-50",
                    isApple && "rounded-full px-1",
                  )}
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
                  isApple && "rounded-full px-1",
                  isActive
                    ? cn(
                        "text-foreground font-medium",
                        isApple && "bg-foreground/10 shadow-sm",
                      )
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
