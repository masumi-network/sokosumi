"use client";

import type { SessionUser } from "@sokosumi/utils";
import gravatarUrl from "gravatar-url";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { mobileChromeSurfaceClass } from "@/app/components/mobile-chrome-surface";
import { resolveAccountDisplayName } from "@/app/components/sidebar/components/account-summary-labels";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import useIsApplePlatform from "@/hooks/use-is-apple-platform";
import { useSession } from "@/lib/auth/auth.client";
import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/utils/text";

import {
  CHAT_MOBILE_TABS,
  type ChatMobileTabId,
} from "./chat-mobile-tab-registry";
import { useChatTabUnreadPresence } from "./use-chat-tab-unread-presence";

type SearchParamsLike =
  | URLSearchParams
  | { get?: (key: string) => string | null }
  | null
  | undefined;

const YOU_TAB_GRAVATAR_SIZE = 80;

export function resolveChatMobileActiveTabId(
  pathname: string,
  searchParams?: SearchParamsLike,
): ChatMobileTabId | null {
  for (const tab of CHAT_MOBILE_TABS) {
    if (!tab.isActive(pathname, searchParams)) {
      continue;
    }
    return tab.id;
  }
  return null;
}

function YouTabAvatar({ sessionUser }: { sessionUser: SessionUser | null }) {
  if (!sessionUser) {
    return (
      <span
        data-testid="mobile-you-tab-avatar-skeleton"
        className="bg-muted size-5 animate-pulse rounded-full"
        aria-hidden
      />
    );
  }

  const displayName = resolveAccountDisplayName(
    sessionUser.name,
    sessionUser.email,
  );

  return (
    <Avatar data-testid="mobile-you-tab-avatar" className="size-5" aria-hidden>
      <AvatarImage
        src={
          sessionUser.image ??
          gravatarUrl(sessionUser.email, {
            size: YOU_TAB_GRAVATAR_SIZE,
            default: "404",
          })
        }
        alt=""
      />
      <AvatarFallback className="bg-muted text-muted-foreground text-[0.5rem] font-medium">
        {getInitials(displayName)}
      </AvatarFallback>
    </Avatar>
  );
}

export function ChatMobileBottomNav(): React.ReactElement {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("App.Channels.MobileNav");
  const activeTabId = resolveChatMobileActiveTabId(pathname, searchParams);
  const isApple = useIsApplePlatform();
  const { showUnreadDot } = useChatTabUnreadPresence();
  const { data: session } = useSession();
  const sessionUser = session?.user ?? null;

  return (
    <nav
      aria-label={t("ariaLabel")}
      className={cn(
        "z-40 md:hidden",
        mobileChromeSurfaceClass(isApple),
        isApple
          ? "fixed inset-x-4 bottom-[max(0.75rem,env(safe-area-inset-bottom))] rounded-full border border-border/40 shadow-lg shadow-black/10 dark:shadow-black/40"
          : "border-border fixed inset-x-0 bottom-0 border-t pb-[env(safe-area-inset-bottom)]",
      )}
    >
      <ul
        className={cn(
          "flex items-stretch",
          isApple ? "h-16 gap-0.5 px-1.5 py-1.5" : "h-16",
        )}
      >
        {CHAT_MOBILE_TABS.map((tab) => {
          const label = t(tab.labelKey);
          const isActive = activeTabId === tab.id;
          const showChatsUnreadDot = tab.id === "chats" && showUnreadDot;

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
                <span className="relative">
                  {tab.id === "you" ? (
                    <YouTabAvatar sessionUser={sessionUser} />
                  ) : (
                    <tab.icon className="size-5" aria-hidden />
                  )}
                  {showChatsUnreadDot ? (
                    <span
                      aria-label={t("chatsUnread")}
                      className="bg-primary ring-background absolute -top-0.5 -right-0.5 size-1.5 rounded-full ring-2"
                    />
                  ) : null}
                </span>
                <span className="truncate">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
