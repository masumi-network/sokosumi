"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { classifyChatChromeSurface } from "@/app/chat/utils/chat-route-base";
import {
  isMainAppMobileChromePathname,
  resolveMobileAppBackTarget,
  shouldShowMobileBrandLeading,
} from "@/app/components/mobile-app-chrome";
import { SokosumiIcon } from "@/components/masumi-logos";

/**
 * Mobile header leading slot (`md:hidden` size-8):
 * - chat home / chats list → Sokosumi icon (no back / hamburger)
 * - chat room / draft compose → back to `/chat/chats`
 * - tab list roots → empty (no back)
 * - non-tab hub roots + nested → back (chats or list root)
 * - otherwise → back to chats
 */
export function HeaderLeadingControl(): React.ReactElement {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("App.Channels.MobileNav");
  const surface = classifyChatChromeSurface(pathname, searchParams);
  const appBack = resolveMobileAppBackTarget(pathname);

  if (shouldShowMobileBrandLeading(pathname, searchParams)) {
    return (
      <span className="inline-flex size-8 shrink-0 items-center justify-center">
        <SokosumiIcon animated={false} className="size-8" />
      </span>
    );
  }

  if (surface === "room" || surface === "draft") {
    return (
      <Link
        href="/chat/chats"
        aria-label={t("backToChats")}
        className="text-foreground hover:bg-accent inline-flex size-8 shrink-0 items-center justify-center rounded-md"
      >
        <ChevronLeft className="size-5" aria-hidden />
      </Link>
    );
  }

  if (appBack) {
    return (
      <Link
        href={appBack.href}
        aria-label={t(appBack.labelKey)}
        className="text-foreground hover:bg-accent inline-flex size-8 shrink-0 items-center justify-center rounded-md"
      >
        <ChevronLeft className="size-5" aria-hidden />
      </Link>
    );
  }

  if (isMainAppMobileChromePathname(pathname)) {
    return <span className="inline-flex size-8 shrink-0" aria-hidden />;
  }

  return (
    <Link
      href="/chat/chats"
      aria-label={t("backToChats")}
      className="text-foreground hover:bg-accent inline-flex size-8 shrink-0 items-center justify-center rounded-md"
    >
      <ChevronLeft className="size-5" aria-hidden />
    </Link>
  );
}

/** Suspense fallback while search params resolve — brand, never hamburger. */
export function HeaderLeadingBrandFallback(): React.ReactElement {
  return (
    <span className="inline-flex size-8 shrink-0 items-center justify-center">
      <SokosumiIcon animated={false} className="size-8" />
    </span>
  );
}
