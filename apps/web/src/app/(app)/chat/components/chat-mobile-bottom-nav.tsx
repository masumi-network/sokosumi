"use client";

import { History, Home, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useHistorySearch } from "@/app/components/history-search-dialog-provider";
import { cn } from "@/lib/utils";

/**
 * Mobile bottom navigation for chat routes.
 * Fixed full-width tab bar with Home, History, and Search.
 * Visible only below md breakpoint.
 */
export function ChatMobileBottomNav() {
  const t = useTranslations("App.Chat.MobileBottomNav");
  const pathname = usePathname();
  const { openHistorySearch } = useHistorySearch();

  const isChatActive = pathname === "/chat" || pathname.startsWith("/chat/");
  const isHistoryActive =
    pathname === "/history" || pathname.startsWith("/history/");

  const tabs = [
    {
      key: "home",
      label: t("home"),
      icon: Home,
      href: "/chat",
      isActive: isChatActive,
    },
    {
      key: "history",
      label: t("history"),
      icon: History,
      href: "/history",
      isActive: isHistoryActive,
    },
    {
      key: "search",
      label: t("search"),
      icon: Search,
      onClick: () => openHistorySearch(),
      isActive: false,
    },
  ];

  return (
    <nav
      className="bg-background fixed inset-x-0 bottom-0 z-50 flex h-16 w-full items-center border-t md:hidden"
      aria-label={t("ariaLabel")}
    >
      <div className="flex w-full items-center justify-around">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const content = (
            <>
              <Icon
                className={cn(
                  "size-5",
                  tab.isActive ? "text-primary" : "text-muted-foreground",
                )}
                aria-hidden
              />
              <span
                className={cn(
                  "text-xs font-medium",
                  tab.isActive ? "text-primary" : "text-muted-foreground",
                )}
              >
                {tab.label}
              </span>
            </>
          );

          if (tab.href) {
            return (
              <Link
                key={tab.key}
                href={tab.href}
                className="hover:bg-muted flex flex-1 flex-col items-center justify-center gap-1 py-2 transition-colors"
                aria-current={tab.isActive ? "page" : undefined}
              >
                {content}
              </Link>
            );
          }

          return (
            <button
              key={tab.key}
              type="button"
              onClick={tab.onClick}
              className="hover:bg-muted flex flex-1 flex-col items-center justify-center gap-1 py-2 transition-colors"
            >
              {content}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
