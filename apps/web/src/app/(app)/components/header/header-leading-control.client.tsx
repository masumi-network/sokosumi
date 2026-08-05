"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { classifyChatChromeSurface } from "@/app/chat/utils/chat-route-base";
import {
  resolveMobileAppBackTarget,
  shouldShowMobileBrandLeading,
} from "@/app/components/mobile-app-chrome";
import { SokosumiIcon } from "@/components/masumi-logos";

import CustomTrigger from "../sidebar/components/custom-trigger";

/**
 * Mobile header leading slot (`md:hidden` size-8):
 * - chat home / chats list → Sokosumi icon (no back / hamburger)
 * - chat room → back to `/chat/chats`
 * - main hub lists + nested → back (home or list root)
 * - otherwise → sidebar CustomTrigger
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

  if (surface === "room") {
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

  return <CustomTrigger when="invisible" />;
}

/** Suspense fallback while search params resolve — brand, never hamburger. */
export function HeaderLeadingBrandFallback(): React.ReactElement {
  return (
    <span className="inline-flex size-8 shrink-0 items-center justify-center">
      <SokosumiIcon animated={false} className="size-8" />
    </span>
  );
}
