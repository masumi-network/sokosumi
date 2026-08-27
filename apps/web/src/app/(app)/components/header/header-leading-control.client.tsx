"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import type { MouseEvent } from "react";

import {
  CHAT_CHATS_LIST_PATH,
  classifyChatChromeSurface,
} from "@/app/chat/utils/chat-route-base";
import {
  resolveMobileAppBackTarget,
  shouldShowMobileBrandLeading,
} from "@/app/components/mobile-app-chrome";
import { getStoredTasksReturnPath } from "@/app/tasks/components/task-navigation";
import { useTasksReturnPath } from "@/app/tasks/components/use-tasks-return-path";
import { SokosumiIcon } from "@/components/masumi-logos";

/**
 * Mobile header leading slot (`md:hidden` size-8):
 * - Welcome home + chats + bottom-nav tab roots → Sokosumi icon Link to `/`
 * - chat room → back to `/chat`
 * - nested tasks → back to stored list URL (view/filters) when present
 * - other nested list pages → back to list root
 * - non-tab hub roots → back to chats
 * - otherwise → back to chats
 */
export function HeaderLeadingControl(): React.ReactElement {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations("App.Channels.MobileNav");
  const surface = classifyChatChromeSurface(pathname, searchParams);
  const appBack = resolveMobileAppBackTarget(pathname);
  const tasksReturnPath = useTasksReturnPath();

  if (shouldShowMobileBrandLeading(pathname, searchParams)) {
    return (
      <Link
        href="/"
        aria-label={t("goHome")}
        className="inline-flex size-8 shrink-0 items-center justify-center"
      >
        <SokosumiIcon animated={false} className="size-8" />
      </Link>
    );
  }

  if (surface === "room") {
    return (
      <Link
        href={CHAT_CHATS_LIST_PATH}
        aria-label={t("backToChats")}
        className="text-foreground hover:bg-accent inline-flex size-8 shrink-0 items-center justify-center rounded-md"
      >
        <ChevronLeft className="size-5" aria-hidden />
      </Link>
    );
  }

  if (appBack) {
    const isTasksBack = appBack.href === "/tasks";
    const href = isTasksBack ? tasksReturnPath : appBack.href;

    function handleTasksBackClick(event: MouseEvent<HTMLAnchorElement>) {
      // Read storage at click time: header stays mounted across list→detail,
      // so href state can lag behind TaskDetailLink writing the return path.
      event.preventDefault();
      router.push(getStoredTasksReturnPath());
    }

    return (
      <Link
        href={href}
        aria-label={t(appBack.labelKey)}
        className="text-foreground hover:bg-accent inline-flex size-8 shrink-0 items-center justify-center rounded-md"
        onClick={isTasksBack ? handleTasksBackClick : undefined}
      >
        <ChevronLeft className="size-5" aria-hidden />
      </Link>
    );
  }

  return (
    <Link
      href={CHAT_CHATS_LIST_PATH}
      aria-label={t("backToChats")}
      className="text-foreground hover:bg-accent inline-flex size-8 shrink-0 items-center justify-center rounded-md"
    >
      <ChevronLeft className="size-5" aria-hidden />
    </Link>
  );
}

/** Suspense fallback while search params resolve — brand link, never hamburger. */
export function HeaderLeadingBrandFallback(): React.ReactElement {
  const t = useTranslations("App.Channels.MobileNav");
  return (
    <Link
      href="/"
      aria-label={t("goHome")}
      className="inline-flex size-8 shrink-0 items-center justify-center"
    >
      <SokosumiIcon animated={false} className="size-8" />
    </Link>
  );
}
