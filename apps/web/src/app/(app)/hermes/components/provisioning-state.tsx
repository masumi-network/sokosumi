"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import FlowBackground from "@/app/hermes/components/flow-background";
import ProgressPips from "@/app/hermes/components/progress-pips";
import RotatingMessages from "@/app/hermes/components/rotating-messages";
import { AssistantOrb } from "@/components/aurora-orb";
import { orderedMessageList } from "@/lib/intl/ordered-message-list";

/**
 * Indeterminate provisioning view. The orchestrator drives the real machine
 * boot — we don't have visibility into per-step progress yet, so the UI
 * shows a single honest "Setting up your agent…" with a calm shimmer rather
 * than a fake-paced step list that misleads the user about timing.
 */
export default function ProvisioningState({ seed }: { seed: string | null }) {
  const t = useTranslations("App.Hermes.Provisioning");
  const facts = orderedMessageList(t.raw("facts") as Record<string, string>);

  return (
    <FlowBackground>
      <div className="mx-auto w-full max-w-2xl px-6 py-8 md:py-12">
        <ProgressPips current="provisioning" />

        {/* ── Hero with the assistant's orb ───────────────────────── */}
        <div className="flex flex-col items-center text-center">
          <AssistantOrb seed={seed} size={160} className="size-20 md:size-24" />
          <h1 className="text-foreground mt-6 text-3xl font-light tracking-tight md:text-4xl">
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
            <div className="text-muted-foreground text-center text-xs font-semibold uppercase tracking-wider">
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
