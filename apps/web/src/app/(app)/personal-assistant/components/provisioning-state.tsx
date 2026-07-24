"use client";

import { Check, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

import FlowBackground from "@/app/personal-assistant/components/flow-background";
import ProgressPips from "@/app/personal-assistant/components/progress-pips";
import RotatingMessages from "@/app/personal-assistant/components/rotating-messages";
import {
  formatElapsed,
  useElapsedSeconds,
} from "@/app/personal-assistant/components/use-elapsed-seconds";
import { AssistantOrb } from "@/components/aurora-orb";
import { orderedMessageList } from "@/lib/intl/ordered-message-list";
import { cn } from "@/lib/utils";

const PROVISIONING_STAGES = [
  {
    afterSeconds: 0,
    titleKey: "stageComputer",
    bodyKey: "stageComputerBody",
  },
  {
    afterSeconds: 20,
    titleKey: "stageWorkspace",
    bodyKey: "stageWorkspaceBody",
  },
  {
    afterSeconds: 50,
    titleKey: "stageReady",
    bodyKey: "stageReadyBody",
  },
] as const;

interface ProvisioningStateProps {
  seed: string | null;
  /** Wall-clock ms when provisioning actually started, persisted across a
   * tab close/reopen. Null falls back to "now" (e.g. preview mode) — the
   * elapsed clock just won't survive a remount in that case. */
  startedAt: number | null;
}

/**
 * Indeterminate provisioning view. The orchestrator drives the real machine
 * boot — we don't have real per-step events yet, so these milestones are
 * explicit expectations with elapsed time rather than backend progress claims.
 */
export default function ProvisioningState({
  seed,
  startedAt,
}: ProvisioningStateProps) {
  const t = useTranslations("App.Hermes.Provisioning");
  const facts = orderedMessageList(t.raw("facts") as Record<string, string>);
  const elapsedSeconds = useElapsedSeconds(startedAt);

  const activeStageIndex = useMemo(() => {
    let active = 0;
    for (const [index, stage] of PROVISIONING_STAGES.entries()) {
      if (elapsedSeconds >= stage.afterSeconds) active = index;
    }
    return active;
  }, [elapsedSeconds]);
  const isLongWait = elapsedSeconds >= 90;

  return (
    <FlowBackground>
      <div className="mx-auto w-full max-w-2xl px-6 py-8 md:py-12">
        <ProgressPips current="provisioning" />

        {/* ── Hero with the assistant's orb ───────────────────────── */}
        <div className="flex flex-col items-center text-center">
          <AssistantOrb
            seed={seed}
            animate={false}
            size={160}
            className="size-20 md:size-24"
          />
          <h1 className="text-foreground mt-6 text-3xl font-light tracking-tight md:text-4xl">
            {t("title")}
          </h1>
          <p className="text-muted-foreground mt-4 max-w-md text-base leading-relaxed">
            {t("subtitle")}
          </p>
        </div>

        {/* ── Loader status + rotating Hermes facts ───────────────── */}
        <div className="border-border/60 bg-card/60 mt-12 rounded-2xl border px-5 py-6 backdrop-blur-md md:px-6 md:py-7">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="inline-flex items-center gap-3">
              <Loader2
                className="text-primary size-4 animate-spin"
                aria-hidden
              />
              <span className="reasoning-text-shine text-foreground text-sm font-medium">
                {t("settingUp")}
              </span>
            </div>
            <span className="text-muted-foreground font-mono text-xs tabular-nums">
              {t("elapsedLabel", { elapsed: formatElapsed(elapsedSeconds) })}
            </span>
          </div>

          <ol className="mt-5 grid gap-2.5">
            {PROVISIONING_STAGES.map((stage, index) => {
              const isDone = index < activeStageIndex;
              const isActive = index === activeStageIndex;

              return (
                <li
                  key={stage.titleKey}
                  className={cn(
                    "border-border/60 bg-background/40 flex items-start gap-3 rounded-xl border px-4 py-3",
                    isActive && "border-primary/40 bg-primary/5",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[0.65rem]",
                      isDone
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : isActive
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border text-muted-foreground",
                    )}
                  >
                    {isDone ? (
                      <Check className="size-3" />
                    ) : isActive ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      index + 1
                    )}
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-foreground text-sm font-medium">
                      {t(stage.titleKey)}
                    </h2>
                    <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                      {t(stage.bodyKey)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>

          {isLongWait ? (
            <div className="border-border/60 bg-background/50 mt-4 rounded-xl border px-4 py-3">
              <h2 className="text-foreground text-sm font-medium">
                {t("longWaitTitle")}
              </h2>
              <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                {t("longWaitBody")}
              </p>
            </div>
          ) : null}

          <div className="border-border/40 mt-5 border-t pt-4">
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
