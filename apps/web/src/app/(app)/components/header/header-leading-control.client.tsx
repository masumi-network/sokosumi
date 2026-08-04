"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { classifyChatChromeSurface } from "@/app/chat/utils/chat-route-base";

import CustomTrigger from "../sidebar/components/custom-trigger";

/**
 * Mobile header leading slot (`md:hidden` size-8):
 * - chat home → spacer (no hamburger)
 * - chat room → back to `/chat`
 * - otherwise → sidebar CustomTrigger
 */
export function HeaderLeadingControl(): React.ReactElement {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("App.Channels.MobileNav");
  const surface = classifyChatChromeSurface(pathname, searchParams);

  if (surface === "home") {
    return <span className="size-8 shrink-0" aria-hidden />;
  }

  if (surface === "room") {
    return (
      <Link
        href="/chat"
        aria-label={t("backToHome")}
        className="text-foreground hover:bg-accent inline-flex size-8 shrink-0 items-center justify-center rounded-md"
      >
        <ArrowLeft className="size-4" aria-hidden />
      </Link>
    );
  }

  return <CustomTrigger when="invisible" />;
}
