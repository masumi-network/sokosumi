"use client";

import { CalendarClock, Inbox, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  disconnectHermesIntegrationAction,
  listHermesSchedulesAction,
  toggleHermesScheduleAction,
  updateHermesInstanceAction,
} from "@/lib/actions/hermes";
import { humanizeCron } from "@/lib/hermes/humanize-cron";
import type {
  HermesAutonomyLevel,
  HermesIntegration,
  HermesIntegrationProvider,
  HermesIntegrationStatus,
  HermesSchedule,
} from "@/lib/hermes/types";
import { cn } from "@/lib/utils";

import AutonomySelector from "./autonomy-selector";
import ConnectInterstitial from "./connect-interstitial";
import { useComposioOAuth } from "./use-composio-oauth";

interface SettingsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  previewMode: boolean;
  integrations: HermesIntegration[];
  /** Current autonomy tier — drives the selector's checked state. */
  autonomyLevel: HermesAutonomyLevel;
  /** From the instance payload — drives the "workspace synced N ago" label. */
  lastSokosumiSyncAt: string | null;
  /** From the instance payload — drives the "memory refreshed N ago" label. */
  lastInboxRefreshAt: string | null;
  /** Notify parent when the orchestrator-side autonomy changed so it can refetch. */
  onAutonomyChanged?: (next: HermesAutonomyLevel) => void;
  onDestroy: () => Promise<void> | void;
}

// Composio's `outlook` toolkit covers mail + calendar in a single connection,
// so the server-side finalize handler registers both `outlook` and
// `outlook_calendar` orchestrator providers from a single OAuth flow.
//
// Settings exposes the full provider menu (essentials shown on onboarding +
// the v2 providers the orchestrator added for power-user connect post-boot).
const PROVIDERS: Array<{
  slug: HermesIntegrationProvider;
  iconSrc: string;
}> = [
  { slug: "gmail", iconSrc: "/icons/gmail.svg" },
  { slug: "google_calendar", iconSrc: "/icons/google-calendar.svg" },
  { slug: "google_sheets", iconSrc: "/icons/google-sheets.svg" },
  { slug: "google_docs", iconSrc: "/icons/google-docs.svg" },
  { slug: "outlook", iconSrc: "/icons/outlook.svg" },
  { slug: "slack", iconSrc: "/icons/slack.svg" },
  { slug: "teams", iconSrc: "/icons/teams.svg" },
  { slug: "linear", iconSrc: "/icons/linear.svg" },
  { slug: "jira", iconSrc: "/icons/jira.svg" },
  { slug: "github", iconSrc: "/icons/github.svg" },
  { slug: "notion", iconSrc: "/icons/notion.svg" },
  { slug: "hubspot", iconSrc: "/icons/hubspot.svg" },
  { slug: "twitter", iconSrc: "/icons/x.svg" },
  { slug: "linkedin", iconSrc: "/icons/linkedin.svg" },
  { slug: "instagram", iconSrc: "/icons/instagram.svg" },
  { slug: "youtube", iconSrc: "/icons/youtube.svg" },
];

const PREVIEW_CONNECT_DELAY_MS = 1_400;

export default function SettingsPanel({
  open,
  onOpenChange,
  previewMode,
  integrations,
  autonomyLevel,
  lastSokosumiSyncAt,
  lastInboxRefreshAt,
  onAutonomyChanged,
  onDestroy,
}: SettingsPanelProps) {
  const t = useTranslations("App.Hermes.Settings");
  const tProviders = useTranslations("App.Hermes.Onboarding.providers");
  const composioOAuth = useComposioOAuth();

  const [destroyPending, startDestroyTransition] = useTransition();
  const [schedules, setSchedules] = useState<HermesSchedule[]>([]);
  const [schedulesLoading, setSchedulesLoading] = useState(false);
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
    },
    [autonomy, previewMode, onAutonomyChanged, t],
  );

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
  const [overlay, setOverlay] = useState<
    Partial<Record<HermesIntegrationProvider, HermesIntegrationStatus>>
  >({});
  const [pendingConnect, setPendingConnect] = useState<{
    provider: HermesIntegrationProvider;
    mode: "read" | "write";
  } | null>(null);

  const integrationByProvider = useMemo(() => {
    const map = new Map<HermesIntegrationProvider, HermesIntegration>();
    for (const i of integrations) map.set(i.provider, i);
    return map;
  }, [integrations]);

  const effectiveStatus = useCallback(
    (provider: HermesIntegrationProvider): HermesIntegrationStatus =>
      overlay[provider] ??
      integrationByProvider.get(provider)?.status ??
      "disconnected",
    [overlay, integrationByProvider],
  );

  const handleConnect = useCallback((provider: HermesIntegrationProvider) => {
    // Always read-only from the settings panel for now; full-access flow
    // lives only on the first-time onboarding screen.
    setPendingConnect({ provider, mode: "read" });
  }, []);

  const runConnect = useCallback(
    async (provider: HermesIntegrationProvider, mode: "read" | "write") => {
      setOverlay((prev) => ({ ...prev, [provider]: "connecting" }));

      if (previewMode) {
        await new Promise((r) => setTimeout(r, PREVIEW_CONNECT_DELAY_MS));
        setOverlay((prev) => ({ ...prev, [provider]: "connected" }));
        return;
      }

      const result = await composioOAuth.start(provider, mode);
      if (!result.ok) {
        const message =
          result.reason === "popup_blocked"
            ? "Allow popups for this site to connect an account."
            : result.reason === "popup_closed"
              ? "Connection cancelled."
              : result.reason === "timeout"
                ? "Connection timed out."
                : (result.message ?? "Couldn't connect this provider.");
        if (result.reason !== "popup_closed") toast.error(message);
        setOverlay((prev) => ({ ...prev, [provider]: "disconnected" }));
        return;
      }
      setOverlay((prev) => ({
        ...prev,
        [provider]: result.integration.status,
      }));
    },
    [previewMode, composioOAuth],
  );

  const handleDisconnect = useCallback(
    async (provider: HermesIntegrationProvider) => {
      const previous = effectiveStatus(provider);
      setOverlay((prev) => ({ ...prev, [provider]: "connecting" }));

      if (previewMode) {
        await new Promise((r) => setTimeout(r, 500));
        setOverlay((prev) => ({ ...prev, [provider]: "disconnected" }));
        return;
      }

      const result = await disconnectHermesIntegrationAction({ provider });
      if (!result.ok) {
        toast.error(
          result.error.message ?? "Couldn't disconnect this provider.",
        );
        setOverlay((prev) => ({ ...prev, [provider]: previous }));
        return;
      }
      setOverlay((prev) => ({ ...prev, [provider]: "disconnected" }));
    },
    [previewMode, effectiveStatus],
  );

  const handleDestroy = () => {
    startDestroyTransition(async () => {
      await onDestroy();
      onOpenChange(false);
    });
  };

  return (
    <>
      <ConnectInterstitial
        pending={
          pendingConnect
            ? {
                provider: pendingConnect.provider,
                providerName: tProviders(pendingConnect.provider),
                mode: pendingConnect.mode,
              }
            : null
        }
        onCancel={() => setPendingConnect(null)}
        onConfirm={() => {
          if (!pendingConnect) return;
          const { provider, mode } = pendingConnect;
          setPendingConnect(null);
          void runConnect(provider, mode);
        }}
      />
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader className="border-b pb-4">
            <SheetTitle>{t("title")}</SheetTitle>
            <SheetDescription>{t("subtitle")}</SheetDescription>
          </SheetHeader>

          <div className="flex flex-col gap-8 px-4 py-6">
            {/* ── Model (read-only) ────────────────────────────── */}
            <section className="flex flex-col gap-3">
              <h3 className="text-foreground text-sm font-medium">
                {t("modelSection")}
              </h3>
              <div className="border-border/60 bg-muted/20 flex flex-col gap-2 rounded-md border px-3 py-3">
                <ReadOnlyField
                  label={t("modelLabel")}
                  value="deepseek-4-flash"
                  mono
                />
                <ReadOnlyField
                  label={t("modelProviderLabel")}
                  value="OpenRouter (managed)"
                />
                <p className="text-tertiary-foreground text-xs leading-relaxed">
                  {t("modelManagedHelp")}
                </p>
              </div>
            </section>

            <Separator />

            {/* ── Autonomy ─────────────────────────────────────── */}
            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-foreground text-sm font-medium">
                  {t("autonomySection")}
                </h3>
                {autonomySaving ? (
                  <span className="text-tertiary-foreground inline-flex items-center gap-1.5 text-xs">
                    <Loader2 className="size-3 animate-spin" aria-hidden />
                    {t("autonomySaving")}
                  </span>
                ) : null}
              </div>
              <p className="text-tertiary-foreground text-xs leading-relaxed">
                {t("autonomyHelp")}
              </p>
              <AutonomySelector
                value={autonomy}
                onChange={(next) => void handleAutonomyChange(next)}
                disabled={autonomySaving}
                compact
              />
            </section>

            <Separator />

            {/* ── Integrations ─────────────────────────────────── */}
            <section className="flex flex-col gap-3">
              <h3 className="text-foreground text-sm font-medium">
                {t("integrationsSection")}
              </h3>
              <p className="text-tertiary-foreground text-xs leading-relaxed">
                {t("integrationsHelp")}
              </p>
              <ul className="flex flex-col gap-2">
                {PROVIDERS.map(({ slug, iconSrc }) => {
                  const status = effectiveStatus(slug);
                  return (
                    <li
                      key={slug}
                      className="border-border/60 bg-background flex items-center gap-3 rounded-md border px-3 py-2.5"
                    >
                      <div
                        aria-hidden
                        className="border-border/60 bg-background flex size-8 shrink-0 items-center justify-center rounded-md border"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={iconSrc} alt="" className="size-4" />
                      </div>
                      <span className="text-foreground flex-1 truncate text-sm">
                        {tProviders(slug)}
                      </span>
                      <IntegrationButton
                        status={status}
                        mode={integrationByProvider.get(slug)?.mode ?? "read"}
                        connectLabel={t("connectIntegration")}
                        connectingLabel={t("connectingIntegration")}
                        connectedLabel={t("connectedIntegration")}
                        disconnectLabel={t("disconnectIntegration")}
                        retryLabel={t("retryIntegration")}
                        onConnect={() => void handleConnect(slug)}
                        onDisconnect={() => void handleDisconnect(slug)}
                      />
                    </li>
                  );
                })}
              </ul>
            </section>

            <Separator />

            {/* ── Workspace sync ───────────────────────────────── */}
            <SyncStatusSection
              lastSokosumiSyncAt={lastSokosumiSyncAt}
              lastInboxRefreshAt={lastInboxRefreshAt}
            />

            <Separator />

            {/* ── Scheduled tasks ──────────────────────────────── */}
            <SchedulesSection
              schedules={schedules}
              loading={schedulesLoading}
              onScheduleUpdated={(updated) =>
                setSchedules((prev) =>
                  prev.map((s) => (s.id === updated.id ? updated : s)),
                )
              }
            />

            <Separator />

            {/* ── Danger zone ──────────────────────────────────── */}
            <section className="flex flex-col gap-3">
              <h3 className="text-destructive text-sm font-medium">
                {t("dangerSection")}
              </h3>
              <div className="border-destructive/30 flex flex-col gap-3 rounded-md border px-3 py-3">
                <div className="flex flex-col gap-1">
                  <span className="text-foreground text-sm font-medium">
                    {t("destroyTitle")}
                  </span>
                  <p className="text-tertiary-foreground text-xs leading-relaxed">
                    {t("destroyBody")}
                  </p>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="gap-2 self-start"
                      disabled={destroyPending}
                    >
                      {destroyPending ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                      ) : (
                        <Trash2 className="size-4" aria-hidden />
                      )}
                      {t("destroyCta")}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t("destroyTitle")}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {t("destroyBody")}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={destroyPending}>
                        {t("cancel")}
                      </AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleDestroy}
                        disabled={destroyPending}
                        className="bg-destructive text-white hover:bg-destructive/90"
                      >
                        {t("destroyCta")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </section>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function ReadOnlyField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-tertiary-foreground text-xs">{label}</span>
      <span
        className={
          mono
            ? "text-foreground font-mono text-sm tabular-nums"
            : "text-foreground text-sm"
        }
      >
        {value}
      </span>
    </div>
  );
}

interface IntegrationButtonProps {
  status: HermesIntegrationStatus;
  mode: "read" | "write";
  connectLabel: string;
  connectingLabel: string;
  connectedLabel: string;
  disconnectLabel: string;
  retryLabel: string;
  onConnect: () => void;
  onDisconnect: () => void;
}

function IntegrationButton({
  status,
  mode,
  connectLabel,
  connectingLabel,
  connectedLabel,
  disconnectLabel,
  retryLabel,
  onConnect,
  onDisconnect,
}: IntegrationButtonProps) {
  if (status === "connecting") {
    return (
      <span className="text-tertiary-foreground inline-flex items-center gap-1.5 text-xs">
        <Loader2 className="size-3 animate-spin" aria-hidden />
        {connectingLabel}
      </span>
    );
  }
  if (status === "connected") {
    return (
      <div className="inline-flex items-center gap-3 text-xs">
        <span className="text-foreground inline-flex items-center gap-1.5">
          <span aria-hidden>✓</span>
          {connectedLabel}
          <span className="text-muted-foreground">
            · {mode === "write" ? "full access" : "read only"}
          </span>
        </span>
        <button
          type="button"
          onClick={onDisconnect}
          className="text-tertiary-foreground hover:text-foreground underline-offset-4 hover:underline"
        >
          {disconnectLabel}
        </button>
      </div>
    );
  }
  if (status === "error") {
    return (
      <Button type="button" size="sm" variant="outline" onClick={onConnect}>
        {retryLabel}
      </Button>
    );
  }
  return (
    <Button type="button" size="sm" variant="outline" onClick={onConnect}>
      {connectLabel}
    </Button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function SyncStatusSection({
  lastSokosumiSyncAt,
  lastInboxRefreshAt,
}: {
  lastSokosumiSyncAt: string | null;
  lastInboxRefreshAt: string | null;
}) {
  const t = useTranslations("App.Hermes.Settings");
  const formatter = useFormatter();

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-foreground text-sm font-medium">
        {t("syncSection")}
      </h3>
      <p className="text-tertiary-foreground text-xs leading-relaxed">
        {t("syncHelp")}
      </p>
      <div className="border-border/60 bg-card/40 divide-y divide-border/60 flex flex-col rounded-md border">
        <SyncRow
          icon={<RefreshCw className="size-4" />}
          label={t("syncWorkspaceLabel")}
          value={
            lastSokosumiSyncAt
              ? t("syncLastRun", {
                  when: formatter.relativeTime(new Date(lastSokosumiSyncAt)),
                })
              : t("syncWorkspaceNever")
          }
          stale={!lastSokosumiSyncAt}
        />
        <SyncRow
          icon={<Inbox className="size-4" />}
          label={t("syncInboxLabel")}
          value={
            lastInboxRefreshAt
              ? t("syncLastRun", {
                  when: formatter.relativeTime(new Date(lastInboxRefreshAt)),
                })
              : t("syncInboxNever")
          }
          stale={!lastInboxRefreshAt}
        />
      </div>
    </section>
  );
}

function SyncRow({
  icon,
  label,
  value,
  stale,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  stale: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <div
        aria-hidden
        className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-md"
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-foreground text-xs font-medium">{label}</div>
        <div
          className={
            stale
              ? "text-tertiary-foreground text-[11px]"
              : "text-muted-foreground text-[11px]"
          }
        >
          {value}
        </div>
      </div>
    </div>
  );
}

function SchedulesSection({
  schedules,
  loading,
  onScheduleUpdated,
}: {
  schedules: HermesSchedule[];
  loading: boolean;
  onScheduleUpdated: (next: HermesSchedule) => void;
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
        <p className="text-tertiary-foreground rounded-md border border-dashed border-border/60 bg-card/40 px-3 py-3 text-xs leading-relaxed">
          {t("schedulesEmpty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {schedules.map((s) => (
            <ScheduleRow key={s.id} schedule={s} onChange={onScheduleChange} />
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
}: {
  schedule: HermesSchedule;
  onChange: (next: HermesSchedule) => void;
}) {
  const t = useTranslations("App.Hermes.Settings");
  const [toggling, setToggling] = useState(false);

  const handleToggle = async () => {
    if (toggling) return;
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

  const chip = (() => {
    switch (schedule.kind) {
      case "user":
        return {
          label: t("schedulesKindUserBadge"),
          className: "bg-primary/10 text-primary",
        };
      case "system_prompt":
        return {
          label: t("schedulesKindSystemPromptBadge"),
          className: "bg-primary/10 text-primary",
        };
      case "system_sweep":
        return {
          label: t("schedulesKindSystemSweepBadge"),
          className: "border-border/60 text-muted-foreground border",
        };
    }
  })();

  return (
    <li
      className={cn(
        "border-border/60 bg-background flex flex-col gap-2 rounded-md border px-3 py-2.5 transition-opacity",
        !schedule.enabled && "opacity-60",
      )}
    >
      <div className="flex items-center gap-2">
        <div
          aria-hidden
          className="bg-primary/10 text-primary flex size-7 shrink-0 items-center justify-center rounded-md"
        >
          <CalendarClock className="size-3.5" />
        </div>
        <span className="text-foreground flex-1 truncate text-sm font-medium">
          {schedule.name}
        </span>
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-xs font-medium uppercase tracking-wider",
            chip.className,
          )}
        >
          {chip.label}
        </span>
      </div>

      {schedule.description ? (
        <p className="text-muted-foreground pl-9 text-xs leading-relaxed">
          {schedule.description}
        </p>
      ) : null}

      <ScheduleMeta
        cronExpr={schedule.cronExpr}
        lastRunAt={schedule.lastRunAt}
        nextRunAt={schedule.nextRunAt}
      />

      <div className="flex items-center justify-end pl-9">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          disabled={toggling}
          onClick={() => void handleToggle()}
        >
          {toggling ? (
            <Loader2 className="size-3 animate-spin" aria-hidden />
          ) : null}
          {schedule.enabled
            ? t("schedulesDisableLabel")
            : t("schedulesEnableLabel")}
        </Button>
      </div>
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
  const human = humanizeCron(cronExpr);

  return (
    <div className="text-tertiary-foreground flex flex-col gap-1 pl-9 text-xs">
      <div
        className="text-foreground/90 text-sm leading-snug"
        title={cronExpr || undefined}
      >
        {human ?? (
          <code className="bg-muted/40 rounded px-1.5 py-0.5 text-xs">
            {cronExpr || "—"}
          </code>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 tabular-nums">
        <span>
          {t("schedulesLastRun")}:{" "}
          {lastRunAt
            ? formatter.relativeTime(new Date(lastRunAt))
            : t("schedulesNeverRan")}
        </span>
        {nextRunAt ? (
          <span>
            {t("schedulesNextRun")}:{" "}
            {formatter.relativeTime(new Date(nextRunAt))}
          </span>
        ) : null}
      </div>
    </div>
  );
}
