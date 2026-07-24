"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import FlowBackground from "@/app/personal-assistant/components/flow-background";
import { AssistantOrb } from "@/components/aurora-orb";

/**
 * Initial load shell — shown while we fetch instance state (and during
 * Next.js route transitions via `loading.tsx`). Keeps the Hermes gradient
 * backdrop so we don't flash an empty page before the real state renders.
 */
export default function LoadingState({
  seed = "personal-assistant",
}: {
  /** Orb seed for the assistant avatar (default placeholder for the route fallback). */
  seed?: string;
}) {
  const t = useTranslations("App.Hermes.Loading");
  const tCommon = useTranslations("App.Hermes.Common");

  return (
    <FlowBackground
      intensity="subtle"
      className="flex h-full min-h-[50vh] flex-col"
    >
      <div
        className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 py-16 text-center md:py-24"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <AssistantOrb
          seed={seed}
          animate={false}
          size={96}
          className="size-20 md:size-24"
          alt={tCommon("hermesAvatarAlt")}
        />
        <div className="border-border/60 bg-card/60 mt-10 inline-flex items-center gap-3 rounded-full border px-5 py-3 backdrop-blur-md">
          <Loader2 className="text-primary size-4 animate-spin" aria-hidden />
          <span className="text-foreground text-sm font-medium">
            {t("message")}
          </span>
        </div>
      </div>
    </FlowBackground>
  );
}
