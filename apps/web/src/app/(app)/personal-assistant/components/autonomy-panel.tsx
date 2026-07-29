"use client";

import { Loader2 } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  listHermesSchedulesAction,
  toggleHermesScheduleAction,
  updateHermesInstanceAction,
} from "@/lib/actions/hermes";
import { humanizeCron } from "@/lib/hermes/humanize-cron";
import type { HermesAutonomyLevel, HermesSchedule } from "@/lib/hermes/types";
import { cn } from "@/lib/utils";

import AutonomySelector from "./autonomy-selector";
import PanelSection from "./panel-section";

interface AutonomyPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  previewMode: boolean;
  /** Current autonomy tier — drives the selector's checked state. */
  autonomyLevel: HermesAutonomyLevel;
  /** Notify parent when the orchestrator-side autonomy changed so it can refetch. */
  onAutonomyChanged?: (next: HermesAutonomyLevel) => void;
  /** Re-pull the instance so the parent's autonomy badge stays fresh. */
  onRefreshInstance?: () => void | Promise<void>;
  hasAssistantPlanCoverage?: boolean;
  onRequireSubscription?: () => void;
}

/**
 * The Autonomy sheet: explains that the assistant acts on its own — running
 * scheduled tasks and taking actions in the background — and gathers the two
 * controls that govern that behaviour (autonomy level + scheduled tasks),
 * moved out of Settings so "what it does by itself" has one obvious home.
 */
export default function AutonomyPanel({
  open,
  onOpenChange,
  previewMode,
  autonomyLevel,
  onAutonomyChanged,
  onRefreshInstance,
  hasAssistantPlanCoverage = false,
  onRequireSubscription,
}: AutonomyPanelProps) {
  const t = useTranslations("App.Hermes.Settings");
  const tPanel = useTranslations("App.Hermes.AutonomyPanel");

  // Optimistic local autonomy: lets the radio reflect the user's click
  // instantly while the PATCH is in flight. Re-syncs from the server prop.
  const [autonomy, setAutonomy] = useState<HermesAutonomyLevel>(autonomyLevel);
  const [autonomySaving, setAutonomySaving] = useState(false);

  useEffect(() => {
    setAutonomy(autonomyLevel);
  }, [autonomyLevel]);

  const handleAutonomyChange = useCallback(
    async (next: HermesAutonomyLevel) => {
      if (next === autonomy) return;
      const previous = autonomy;
      setAutonomy(next);

      if (previewMode) return;

      if (!hasAssistantPlanCoverage) {
        setAutonomy(previous);
        onRequireSubscription?.();
        return;
      }

      setAutonomySaving(true);
      // Piggyback the browser-detected IANA timezone every time the user
      // touches autonomy. Idempotent on the orchestrator side; saves us a
      // separate "set my timezone" step. Try/catch because some browsers
      // (rare) return undefined here.
      let timezone: string | undefined;
      try {
        timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      } catch {
        timezone = undefined;
      }
      const result = await updateHermesInstanceAction({
        autonomyLevel: next,
        timezone,
      });
      setAutonomySaving(false);

      if (!result.ok) {
        setAutonomy(previous);
        toast.error(result.error.message ?? t("autonomySaveFailed"));
        return;
      }
      toast.success(t("autonomySavedToast"));
      onAutonomyChanged?.(result.data.autonomyLevel);
      // Sync parent state so the next time the sheet opens it doesn't
      // resync the selector from the stale `autonomyLevel` prop.
      void onRefreshInstance?.();
    },
    [
      autonomy,
      previewMode,
      hasAssistantPlanCoverage,
      onRequireSubscription,
      onAutonomyChanged,
      onRefreshInstance,
      t,
    ],
  );

  const [schedules, setSchedules] = useState<HermesSchedule[]>([]);
  const [schedulesLoading, setSchedulesLoading] = useState(false);

  // Fetch schedules whenever the panel opens — cheap, returns 404/empty in
  // dev before the orchestrator has anything to report.
  useEffect(() => {
    if (!open || previewMode) return;
    let cancelled = false;
    setSchedulesLoading(true);
    void listHermesSchedulesAction({}).then((result) => {
      if (cancelled) return;
      setSchedulesLoading(false);
      if (result.ok) setSchedules(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [open, previewMode]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader className="border-border/40 border-b px-6 pt-6 pb-4">
          <SheetTitle className="text-foreground text-lg font-semibold tracking-tight">
            {tPanel("title")}
          </SheetTitle>
          <SheetDescription className="text-muted-foreground text-sm">
            {tPanel("subtitle")}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-10 px-6 py-6">
          {/* ── Autonomy level ─────────────────────────────────── */}
          <PanelSection
            title={t("autonomySection")}
            description={t("autonomyHelp")}
            trailing={
              autonomySaving ? (
                <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
                  <Loader2 className="size-3 animate-spin" aria-hidden />
                  {t("autonomySaving")}
                </span>
              ) : null
            }
          >
            <AutonomySelector
              value={autonomy}
              onChange={(next) => void handleAutonomyChange(next)}
              disabled={autonomySaving}
              compact
            />
          </PanelSection>

          {/* ── Scheduled tasks ────────────────────────────────── */}
          <SchedulesSection
            schedules={schedules}
            loading={schedulesLoading}
            hasAssistantPlanCoverage={hasAssistantPlanCoverage}
            onRequireSubscription={onRequireSubscription}
            onScheduleUpdated={(updated) =>
              setSchedules((prev) =>
                prev.map((s) => (s.id === updated.id ? updated : s)),
              )
            }
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function SchedulesSection({
  schedules,
  loading,
  onScheduleUpdated,
  hasAssistantPlanCoverage = false,
  onRequireSubscription,
}: {
  schedules: HermesSchedule[];
  loading: boolean;
  onScheduleUpdated: (next: HermesSchedule) => void;
  hasAssistantPlanCoverage?: boolean;
  onRequireSubscription?: () => void;
}) {
  const t = useTranslations("App.Hermes.Settings");
  const onScheduleChange = onScheduleUpdated;

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-foreground text-sm font-medium">
        {t("schedulesSection")}
      </h3>
      <p className="text-tertiary-foreground text-xs leading-relaxed">
        {t("schedulesHelp")}
      </p>
      {loading && schedules.length === 0 ? (
        <div className="text-muted-foreground inline-flex items-center gap-2 text-xs">
          <Loader2 className="size-3 animate-spin" aria-hidden />
          <span>{t("schedulesLoading")}</span>
        </div>
      ) : schedules.length === 0 ? (
        <p className="text-tertiary-foreground border-border/60 bg-card/40 rounded-md border border-dashed px-3 py-3 text-xs leading-relaxed">
          {t("schedulesEmpty")}
        </p>
      ) : (
        <ul className="border-border/60 divide-border/60 divide-y overflow-hidden rounded-xl border">
          {schedules.map((s) => (
            <ScheduleRow
              key={s.id}
              schedule={s}
              onChange={onScheduleChange}
              hasAssistantPlanCoverage={hasAssistantPlanCoverage}
              onRequireSubscription={onRequireSubscription}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * One row in the schedules list. Renders by `kind`:
 *
 *   - user          — "Created by you" chip; toggle visible (delete TBD).
 *   - system_prompt — "Auto-created" chip; shows description; toggle visible.
 *   - system_sweep  — "Background task" chip; toggle visible.
 *
 * Toggle PATCHes the orchestrator and replaces the row in parent state with
 * the returned schedule (so `enabled` flips immediately + `nextRunAt`
 * refreshes when the orchestrator resyncs).
 */
function ScheduleRow({
  schedule,
  onChange,
  hasAssistantPlanCoverage = false,
  onRequireSubscription,
}: {
  schedule: HermesSchedule;
  onChange: (next: HermesSchedule) => void;
  hasAssistantPlanCoverage?: boolean;
  onRequireSubscription?: () => void;
}) {
  const t = useTranslations("App.Hermes.Settings");
  const [toggling, setToggling] = useState(false);

  const handleToggle = async () => {
    if (toggling) return;
    if (!hasAssistantPlanCoverage) {
      onRequireSubscription?.();
      return;
    }
    setToggling(true);
    const result = await toggleHermesScheduleAction({
      scheduleId: schedule.id,
      enabled: !schedule.enabled,
    });
    setToggling(false);
    if (!result.ok) {
      toast.error(result.error.message ?? t("schedulesToggleFailed"));
      return;
    }
    onChange(result.data);
  };

  // Kind label sits inline as muted text. No colored chip — the panel
  // background is already busy enough with the integrations card.
  const kindLabel = (() => {
    switch (schedule.kind) {
      case "user":
        return t("schedulesKindUserBadge");
      case "system_prompt":
        return t("schedulesKindSystemPromptBadge");
      case "system_sweep":
        return t("schedulesKindSystemSweepBadge");
    }
  })();

  return (
    <li
      className={cn(
        "flex items-start gap-3 px-4 py-3 transition-opacity",
        !schedule.enabled && "opacity-50",
      )}
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-baseline gap-2">
          <span className="text-foreground truncate text-sm font-medium">
            {schedule.name}
          </span>
          <span className="text-muted-foreground/70 text-xs font-medium uppercase tracking-wider">
            {kindLabel}
          </span>
        </div>
        <ScheduleMeta
          cronExpr={schedule.cronExpr}
          lastRunAt={schedule.lastRunAt}
          nextRunAt={schedule.nextRunAt}
        />
        {schedule.description ? (
          <p className="text-muted-foreground/80 pt-1 text-xs leading-relaxed">
            {schedule.description}
          </p>
        ) : null}
      </div>

      {/* Synthesized id rows (orchestrator omitted the id) can't be PATCHed —
          hide the toggle so the user doesn't click into a silent failure. */}
      {schedule.addressable ? (
        <button
          type="button"
          disabled={toggling}
          onClick={() => void handleToggle()}
          aria-label={
            schedule.enabled
              ? t("schedulesDisableLabel")
              : t("schedulesEnableLabel")
          }
          className={cn(
            "relative mt-0.5 inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full border transition-colors",
            schedule.enabled
              ? "border-foreground bg-foreground"
              : "border-border bg-muted",
            toggling && "opacity-60",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "absolute top-1/2 -translate-y-1/2 rounded-full transition-all",
              schedule.enabled
                ? "bg-background left-3.5 size-2.5"
                : "bg-foreground/60 left-0.5 size-2.5",
            )}
          />
        </button>
      ) : null}
    </li>
  );
}

/**
 * Per-row "meta" line under each schedule. Leads with a human-readable
 * phrase ("Every weekday at 8:00 AM") via `humanizeCron`; falls back to
 * the raw cron expression when the pattern is too exotic to phrase
 * confidently. The raw expression is always available on hover so power
 * users can verify what Hermes parsed.
 */
function ScheduleMeta({
  cronExpr,
  lastRunAt,
  nextRunAt,
}: {
  cronExpr: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
}) {
  const t = useTranslations("App.Hermes.Settings");
  const formatter = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const human = humanizeCron(cronExpr);

  return (
    <div className="text-muted-foreground text-xs">
      <span title={cronExpr || undefined}>{human ?? cronExpr ?? "—"}</span>
      <span className="text-muted-foreground/60 px-1.5">·</span>
      <span className="tabular-nums">
        {nextRunAt
          ? `${t("schedulesNextRun")} ${formatter.relativeTime(new Date(nextRunAt), now)}`
          : lastRunAt
            ? `${t("schedulesLastRun")} ${formatter.relativeTime(new Date(lastRunAt), now)}`
            : t("schedulesNeverRan")}
      </span>
    </div>
  );
}
