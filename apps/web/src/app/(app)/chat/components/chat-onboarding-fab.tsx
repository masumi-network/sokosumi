"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import {
  chatMobileCreateFabBottom,
  chatMobileCreateFabScrimBottom,
} from "@/app/chat/components/chat-mobile-create-fab-actions";
import { shouldShowMobileCreateFab } from "@/app/components/mobile-app-chrome";
import { MorphingActionFab } from "@/components/mobile/morphing-action-fab";
import useIsApplePlatform from "@/hooks/use-is-apple-platform";

/** Thin chats adapter: visibility gate + bottom offsets + onboarding href. */
export function ChatOnboardingFab(): React.ReactElement | null {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("App.Chat.Onboarding");
  const isApple = useIsApplePlatform();

  if (!shouldShowMobileCreateFab(pathname, searchParams)) {
    return null;
  }

  return (
    <MorphingActionFab
      href="/chat?welcome=1"
      label={t("openFab")}
      bottomClassName={chatMobileCreateFabBottom(isApple)}
      scrimBottomClassName={chatMobileCreateFabScrimBottom(isApple)}
    />
  );
}
