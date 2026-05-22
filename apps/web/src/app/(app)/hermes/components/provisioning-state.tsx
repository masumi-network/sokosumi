"use client";

import { Loader2 } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";

import FlowBackground from "@/app/hermes/components/flow-background";
import ProgressPips from "@/app/hermes/components/progress-pips";
import RotatingMessages from "@/app/hermes/components/rotating-messages";

/**
 * Indeterminate provisioning view. The orchestrator drives the real machine
 * boot — we don't have visibility into per-step progress yet, so the UI
 * shows a single honest "Setting up your agent…" with a calm shimmer rather
 * than a fake-paced step list that misleads the user about timing.
 */
export default function ProvisioningState() {
  const t = useTranslations("App.Hermes.Provisioning");
  const facts = t.raw("facts") as string[];

  return (
    <FlowBackground className="flex h-full flex-col overflow-hidden">
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-8 md:py-12">
        <ProgressPips current="provisioning" />

        {/* ── Hero with Hermes avatar ─────────────────────────────── */}
        <div className="flex flex-col items-center text-center">
          <div className="bg-card border-border/60 ring-border/40 relative size-20 overflow-hidden rounded-full border ring-4 md:size-24">
            <Image
              src="/images/hermes/avatar.png"
              alt=""
              fill
              sizes="96px"
              className="object-cover"
            />
          </div>
          <h1 className="text-foreground mt-6 text-3xl font-semibold tracking-tight md:text-4xl">
            {t("title")}
          </h1>
          <p className="text-muted-foreground mt-4 max-w-md text-base leading-relaxed">
            {t("subtitle")}
          </p>
        </div>

        {/* ── Loader status + rotating Hermes facts ───────────────── */}
        <div className="border-border/60 bg-card/60 mt-12 flex flex-col items-center gap-4 rounded-2xl border px-6 py-8 backdrop-blur-md">
          <div className="inline-flex items-center gap-3">
            <Loader2 className="text-primary size-4 animate-spin" aria-hidden />
            <span className="reasoning-text-shine text-foreground text-sm font-medium">
              {t("settingUp")}
            </span>
          </div>
          <div className="border-border/40 mt-2 w-full max-w-md border-t pt-4">
            <div className="text-muted-foreground text-center text-[11px] font-semibold uppercase tracking-wider">
              {t("whileYouWait")}
            </div>
            <div className="mt-3 flex min-h-[3rem] items-center justify-center">
              <RotatingMessages
                messages={facts}
                intervalMs={5_500}
                className="text-foreground/80 max-w-md text-center text-sm leading-relaxed"
              />
            </div>
          </div>
        </div>
      </div>
    </FlowBackground>
  );
}
