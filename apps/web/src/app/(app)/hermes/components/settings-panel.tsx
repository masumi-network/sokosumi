"use client";

import { Inbox, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import { hermesOAuthConnectErrorMessage } from "@/app/hermes/components/hermes-oauth-messages";

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
import SkillsMarketplace from "./skills-marketplace";
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
  /** Re-pull the instance so the parent's `integrations` snapshot stays
   * fresh after connect/disconnect/autonomy mutations. The panel keeps a
   * local overlay for snappy UI, but the chip / autonomy badge upstream
   * read from parent state. */
  onRefreshInstance?: () => void | Promise<void>;
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
  onRefreshInstance,
}: SettingsPanelProps) {
  const t = useTranslations("App.Hermes.Settings");
  const tProviders = useTranslations("App.Hermes.Onboarding.providers");
  const tOAuth = useTranslations("App.Hermes.Common.oauth");
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
      // Sync parent state so the next time the sheet opens it doesn't
      // resync the selector from the stale `autonomyLevel` prop.
      void onRefreshInstance?.();
    },
    [autonomy, previewMode, onAutonomyChanged, onRefreshInstance, t],
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
        const message = hermesOAuthConnectErrorMessage(
          tOAuth,
          result.reason,
          result.message,
        );
        if (result.reason !== "popup_closed") toast.error(message);
        setOverlay((prev) => ({ ...prev, [provider]: "disconnected" }));
        return;
      }
      setOverlay((prev) => ({
        ...prev,
        [provider]: result.integration.status,
      }));
      // Re-pull the instance so the parent's integrations chip / pending
      // confirmations reflect the new state immediately instead of waiting
      // for the next background refresh tick.
      void onRefreshInstance?.();
    },
    [previewMode, composioOAuth, onRefreshInstance, tOAuth],
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
        toast.error(result.error.message ?? tOAuth("disconnectFailed"));
        setOverlay((prev) => ({ ...prev, [provider]: previous }));
        return;
      }
      setOverlay((prev) => ({ ...prev, [provider]: "disconnected" }));
      void onRefreshInstance?.();
    },
    [previewMode, effectiveStatus, onRefreshInstance],
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
          <SheetHeader className="border-border/40 border-b px-6 pt-6 pb-4">
            <SheetTitle className="text-foreground text-lg font-semibold tracking-tight">
              {t("title")}
            </SheetTitle>
            <SheetDescription className="text-muted-foreground text-sm">
              {t("subtitle")}
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-col gap-10 px-6 py-6">
            {/* ── Autonomy (most-used; leads the panel) ─────────── */}
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

            {/* ── Integrations ─────────────────────────────────── */}
            <PanelSection
              title={t("integrationsSection")}
              description={t("integrationsHelp")}
            >
              <IntegrationList
                providers={PROVIDERS}
                effectiveStatus={effectiveStatus}
                integrationByProvider={integrationByProvider}
                tProviders={tProviders}
                connectLabel={t("connectIntegration")}
                connectingLabel={t("connectingIntegration")}
                connectedLabel={t("connectedIntegration")}
                disconnectLabel={t("disconnectIntegration")}
                retryLabel={t("retryIntegration")}
                onConnect={handleConnect}
                onDisconnect={handleDisconnect}
              />
            </PanelSection>

            {/* ── Skills (skills.sh marketplace) ───────────────── */}
            {!previewMode ? <SkillsMarketplace variant="settings" /> : null}

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

            {/* ── Memory refresh (informational, compact) ─────── */}
            <SyncStatusSection
              lastSokosumiSyncAt={lastSokosumiSyncAt}
              lastInboxRefreshAt={lastInboxRefreshAt}
            />

            {/* ── Model (reference info, lowest priority) ──────── */}
            <PanelSection title={t("modelSection")}>
              <div className="border-border/60 bg-card/40 flex flex-col gap-2.5 rounded-xl border px-4 py-3.5">
                <ReadOnlyField
                  label={t("modelLabel")}
                  value={t("modelValue")}
                  mono
                />
                <ReadOnlyField
                  label={t("modelProviderLabel")}
                  value={t("modelProviderValue")}
                />
                <p className="text-muted-foreground/80 text-xs leading-relaxed">
                  {t("modelManagedHelp")}
                </p>
              </div>
            </PanelSection>

            {/* ── Danger zone ──────────────────────────────────── */}
            <section className="border-destructive/20 flex items-start gap-4 rounded-xl border border-dashed px-4 py-4">
              <div className="min-w-0 flex-1">
                <h3 className="text-destructive text-sm font-semibold tracking-tight">
                  {t("destroyTitle")}
                </h3>
                <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                  {t("destroyBody")}
                </p>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="gap-1.5 self-start"
                    disabled={destroyPending}
                  >
                    {destroyPending ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Trash2 className="size-3.5" aria-hidden />
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
            </section>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Section frame for the settings panel. One consistent header pattern
 * (semibold title + optional muted description + optional right-aligned
 * trailing slot) across the whole sheet. Spacing between sections is
 * owned by the parent `gap-10` so we don't need `<Separator />` lines.
 */
function PanelSection({
  title,
  description,
  trailing,
  children,
}: {
  title: string;
  description?: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-foreground text-sm font-semibold tracking-tight">
            {title}
          </h3>
          {description ? (
            <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
              {description}
            </p>
          ) : null}
        </div>
        {trailing ? <div className="shrink-0">{trailing}</div> : null}
      </div>
      {children}
    </section>
  );
}

interface IntegrationListProps {
  providers: Array<{
    slug: HermesIntegrationProvider;
    iconSrc: string;
  }>;
  effectiveStatus: (
    provider: HermesIntegrationProvider,
  ) => HermesIntegrationStatus;
  integrationByProvider: Map<HermesIntegrationProvider, HermesIntegration>;
  tProviders: (key: string) => string;
  connectLabel: string;
  connectingLabel: string;
  connectedLabel: string;
  disconnectLabel: string;
  retryLabel: string;
  onConnect: (provider: HermesIntegrationProvider) => void;
  onDisconnect: (provider: HermesIntegrationProvider) => void;
}

/**
 * Integration list split into connected vs available groups. Connected
 * rises to the top so the user sees their actual integrations first;
 * the rest sits as a muted "Available" list below. Each row is a single
 * flat strip (no nested icon-tile border) so the chrome reads quietly.
 */
function IntegrationList({
  providers,
  effectiveStatus,
  integrationByProvider,
  tProviders,
  connectLabel,
  connectingLabel,
  connectedLabel,
  disconnectLabel,
  retryLabel,
  onConnect,
  onDisconnect,
}: IntegrationListProps) {
  const connected = providers.filter(
    (p) => effectiveStatus(p.slug) === "connected",
  );
  const available = providers.filter(
    (p) => effectiveStatus(p.slug) !== "connected",
  );

  const renderRow = ({
    slug,
    iconSrc,
  }: IntegrationListProps["providers"][number]) => {
    const status = effectiveStatus(slug);
    return (
      <li
        key={slug}
        className={cn(
          "group/row hover:bg-muted/30 flex items-center gap-3 px-4 py-2.5 transition-colors",
          status === "connected" && "bg-card/40",
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={iconSrc} alt="" className="size-5 shrink-0" />
        <span className="text-foreground flex-1 truncate text-sm">
          {tProviders(slug)}
        </span>
        <IntegrationButton
          status={status}
          mode={integrationByProvider.get(slug)?.mode ?? "read"}
          connectLabel={connectLabel}
          connectingLabel={connectingLabel}
          connectedLabel={connectedLabel}
          disconnectLabel={disconnectLabel}
          retryLabel={retryLabel}
          onConnect={() => void onConnect(slug)}
          onDisconnect={() => void onDisconnect(slug)}
        />
      </li>
    );
  };

  return (
    <div className="border-border/60 divide-border/60 overflow-hidden rounded-xl border divide-y">
      {connected.length > 0 ? (
        <>
          <div className="bg-card/60 text-muted-foreground px-4 py-1.5 text-xs font-medium uppercase tracking-wider">
            Connected
          </div>
          <ul className="divide-border/60 divide-y">
            {connected.map(renderRow)}
          </ul>
        </>
      ) : null}
      {available.length > 0 ? (
        <>
          <div className="bg-card/60 text-muted-foreground px-4 py-1.5 text-xs font-medium uppercase tracking-wider">
            Available
          </div>
          <ul className="divide-border/60 divide-y">
            {available.map(renderRow)}
          </ul>
        </>
      ) : null}
    </div>
  );
}

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
      <div className="inline-flex items-center gap-3">
        <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
          <span aria-hidden className="size-1.5 rounded-full bg-emerald-500" />
          {mode === "write" ? "full access" : "read only"}
        </span>
        <button
          type="button"
          onClick={onDisconnect}
          className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline"
        >
          {disconnectLabel}
        </button>
      </div>
    );
  }
  if (status === "error") {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 px-2.5 text-xs"
        onClick={onConnect}
      >
        {retryLabel}
      </Button>
    );
  }
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-7 px-2.5 text-xs"
      onClick={onConnect}
    >
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
  const now = useNow({ updateInterval: 60_000 });

  return (
    <PanelSection title={t("syncSection")} description={t("syncHelp")}>
      <div className="border-border/60 divide-border/60 flex flex-col divide-y overflow-hidden rounded-xl border">
        <SyncRow
          icon={<RefreshCw className="size-3.5" />}
          label={t("syncWorkspaceLabel")}
          value={
            lastSokosumiSyncAt
              ? t("syncLastRun", {
                  when: formatter.relativeTime(
                    new Date(lastSokosumiSyncAt),
                    now,
                  ),
                })
              : t("syncWorkspaceNever")
          }
          stale={!lastSokosumiSyncAt}
        />
        <SyncRow
          icon={<Inbox className="size-3.5" />}
          label={t("syncInboxLabel")}
          value={
            lastInboxRefreshAt
              ? t("syncLastRun", {
                  when: formatter.relativeTime(
                    new Date(lastInboxRefreshAt),
                    now,
                  ),
                })
              : t("syncInboxNever")
          }
          stale={!lastInboxRefreshAt}
        />
      </div>
    </PanelSection>
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
    <div className="hover:bg-muted/30 flex items-center gap-3 px-4 py-2.5 transition-colors">
      <span className="text-muted-foreground shrink-0" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-foreground text-sm font-medium">{label}</div>
        <div
          className={cn(
            "text-xs",
            stale ? "text-muted-foreground/70" : "text-muted-foreground",
          )}
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
        <ul className="border-border/60 divide-border/60 overflow-hidden rounded-xl border divide-y">
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
          <span className="text-muted-foreground/70 text-[10px] font-medium uppercase tracking-wider">
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
