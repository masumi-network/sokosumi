"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import type { MouseEvent } from "react";

import { useChromePathname } from "@/app/chat/components/room-cache-provider";
import { CHAT_CHATS_LIST_PATH } from "@/app/chat/utils/chat-route-base";
import {
  getAgentJobsPathAgentId,
  resolveMobileAppBackTarget,
  shouldShowMobileBrandLeading,
} from "@/app/components/mobile-app-chrome";
import { useIsAgentUnavailable } from "@/app/components/unavailable-agent.client";
import { getStoredTasksReturnPath } from "@/app/tasks/components/task-navigation";
import { useTasksReturnPath } from "@/app/tasks/components/use-tasks-return-path";
import { BackLink } from "@/components/back-link";
import { SokosumiIcon } from "@/components/masumi-logos";
import { navigateBack } from "@/lib/navigation/navigate-back";

/**
 * Mobile header leading slot (`md:hidden` size-10):
 * - Welcome home + chats + bottom-nav tab roots → Sokosumi icon Link to `/`
 * - chat room → back to `/chat`
 * - nested tasks → back to stored list URL (view/filters) when present; a
 *   task opened from the Calendar → back to that Calendar view
 * - other nested list pages → back to list root
 * - Developer sections → back to the You → Developer menu; their detail
 *   pages → back to the section list
 * - non-tab hub roots → back to chats
 * - otherwise → back to chats
 */
export function HeaderLeadingControl(): React.ReactElement {
  const pathname = useChromePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations("App.Channels.MobileNav");
  const appBack = resolveMobileAppBackTarget(pathname, searchParams);
  // Only a task's own page goes back to the Calendar it was opened from.
  const allowCalendar = isTaskDetailPathname(pathname);
  const tasksReturnPath = useTasksReturnPath({ allowCalendar });
  const agentUnavailable = useIsAgentUnavailable(
    getAgentJobsPathAgentId(pathname),
  );

  if (shouldShowMobileBrandLeading(pathname, searchParams)) {
    return (
      <Link
        href="/"
        aria-label={t("goHome")}
        className="inline-flex size-10 shrink-0 items-center justify-center"
      >
        <SokosumiIcon animated={false} className="size-8" />
      </Link>
    );
  }

  if (appBack) {
    const isTasksBack = appBack.href === "/tasks";
    const href = isTasksBack
      ? (tasksReturnPath ?? appBack.href)
      : agentUnavailable
        ? "/agents"
        : appBack.href;

    function handleTasksBackClick(event: MouseEvent<HTMLAnchorElement>) {
      // Read storage at click time: header stays mounted across list→detail,
      // so href state can lag behind TaskDetailLink writing the return path.
      event.preventDefault();
      navigateBack(
        router,
        getStoredTasksReturnPath({
          taskPath: allowCalendar ? pathname : undefined,
        }),
      );
    }

    return (
      <BackLink
        href={href}
        aria-label={t(appBack.labelKey)}
        className="text-foreground press hover:bg-accent inline-flex size-10 shrink-0 items-center justify-center rounded-md"
        onClick={isTasksBack ? handleTasksBackClick : undefined}
        prefetchOnMount={!isTasksBack || tasksReturnPath !== null}
      >
        <ChevronLeft className="size-5" aria-hidden />
      </BackLink>
    );
  }

  // A chat room, and any page without a list of its own, goes back to Chats.
  return (
    <BackLink
      href={CHAT_CHATS_LIST_PATH}
      aria-label={t("backToChats")}
      className="text-foreground press hover:bg-accent inline-flex size-10 shrink-0 items-center justify-center rounded-md"
    >
      <ChevronLeft className="size-5" aria-hidden />
    </BackLink>
  );
}

function isTaskDetailPathname(pathname: string) {
  return /^\/tasks\/[^/]+$/.test(pathname) && pathname !== "/tasks/archived";
}

/** Suspense fallback while search params resolve — brand link, never hamburger. */
export function HeaderLeadingBrandFallback(): React.ReactElement {
  const t = useTranslations("App.Channels.MobileNav");
  return (
    <Link
      href="/"
      aria-label={t("goHome")}
      className="inline-flex size-10 shrink-0 items-center justify-center"
    >
      <SokosumiIcon animated={false} className="size-8" />
    </Link>
  );
}
