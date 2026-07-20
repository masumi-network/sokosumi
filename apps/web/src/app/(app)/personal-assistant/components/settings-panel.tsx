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
import { hermesOAuthConnectErrorMessage } from "@/app/personal-assistant/components/hermes-oauth-messages";
import { AuroraOrb, PlaceholderOrb } from "@/components/aurora-orb";

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
  updateHermesInstanceAction,
} from "@/lib/actions/hermes";
import { orbCandidateSeeds } from "@/lib/aurora-orb";
import type {
  HermesIntegration,
  HermesIntegrationProvider,
  HermesIntegrationStatus,
} from "@/lib/hermes/types";
import { cn } from "@/lib/utils";

import ConnectInterstitial from "./connect-interstitial";
import PanelSection from "./panel-section";
import SkillsMarketplace from "./skills-marketplace";
import { useComposioOAuth } from "./use-composio-oauth";

interface SettingsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  previewMode: boolean;
  /** Current assistant display name (null until the user names it). */
  assistantName: string | null;
  /** Persisted orb seed (null = white placeholder). */
  avatarSeed: string | null;
  /** Base seed for the curated palette (the user's id). */
  orbBaseSeed: string;
  integrations: HermesIntegration[];
  /** From the instance payload — drives the "workspace synced N ago" label. */
  lastSokosumiSyncAt: string | null;
  /** From the instance payload — drives the "memory refreshed N ago" label. */
  lastInboxRefreshAt: string | null;
  onDestroy: () => Promise<void> | void;
  /** Re-pull the instance so the parent's `integrations` snapshot stays
   * fresh after connect/disconnect/autonomy mutations. The panel keeps a
   * local overlay for snappy UI, but the chip / autonomy badge upstream
   * read from parent state. */
  onRefreshInstance?: () => void | Promise<void>;
  /** Paid coverage for settings mutations (rename, connect, skills…). */
  hasActiveSubscription?: boolean;
  onRequireSubscription?: () => void;
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
  assistantName,
  avatarSeed,
  orbBaseSeed,
  integrations,
  lastSokosumiSyncAt,
  lastInboxRefreshAt,
  onDestroy,
  onRefreshInstance,
  hasActiveSubscription = true,
  onRequireSubscription,
}: SettingsPanelProps) {
  const t = useTranslations("App.Hermes.Settings");
  const tProviders = useTranslations("App.Hermes.Onboarding.providers");
  const tOAuth = useTranslations("App.Hermes.Common.oauth");
  const composioOAuth = useComposioOAuth();

  const [destroyPending, startDestroyTransition] = useTransition();
  // Optimistic local draft for the assistant name. Resyncs from the server
  // prop so reopening the sheet reflects the persisted value.
  const [nameDraft, setNameDraft] = useState(assistantName ?? "");
  const [nameSaving, setNameSaving] = useState(false);

  useEffect(() => {
    setNameDraft(assistantName ?? "");
  }, [assistantName]);

  const handleSaveName = useCallback(async () => {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === (assistantName ?? "")) return;

    if (previewMode) {
      toast.success(t("nameSavedToast"));
      return;
    }

    if (!hasActiveSubscription) {
      onRequireSubscription?.();
      return;
    }

    setNameSaving(true);
    const result = await updateHermesInstanceAction({ assistantName: trimmed });
    setNameSaving(false);

    if (!result.ok) {
      toast.error(result.error.message ?? t("nameSaveFailed"));
      return;
    }
    toast.success(t("nameSavedToast"));
    void onRefreshInstance?.();
  }, [
    nameDraft,
    assistantName,
    previewMode,
    hasActiveSubscription,
    onRequireSubscription,
    onRefreshInstance,
    t,
  ]);
  const tOnboarding = useTranslations("App.Hermes.Onboarding");
  const orbSeeds = useMemo(() => orbCandidateSeeds(orbBaseSeed), [orbBaseSeed]);
  // Optimistic local orb choice, resynced from the server prop — same
  // pattern as the name/autonomy drafts above.
  const [orbDraft, setOrbDraft] = useState<string | null>(avatarSeed);
  const [orbSaving, setOrbSaving] = useState(false);

  useEffect(() => {
    setOrbDraft(avatarSeed);
  }, [avatarSeed]);

  const handlePickOrb = useCallback(
    async (seed: string | null) => {
      if (orbSaving || seed === orbDraft) return;
      const previous = orbDraft;
      setOrbDraft(seed);

      if (previewMode) {
        toast.success(t("lookSavedToast"));
        return;
      }

      if (!hasActiveSubscription) {
        setOrbDraft(previous);
        onRequireSubscription?.();
        return;
      }

      setOrbSaving(true);
      const result = await updateHermesInstanceAction({ avatarSeed: seed });
      setOrbSaving(false);

      if (!result.ok) {
        setOrbDraft(previous);
        toast.error(result.error.message ?? t("lookSaveFailed"));
        return;
      }
      toast.success(t("lookSavedToast"));
      void onRefreshInstance?.();
    },
    [
      orbDraft,
      orbSaving,
      previewMode,
      hasActiveSubscription,
      onRequireSubscription,
      onRefreshInstance,
      t,
    ],
  );

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
      if (!previewMode && !hasActiveSubscription) {
        onRequireSubscription?.();
        return;
      }

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
    [
      previewMode,
      hasActiveSubscription,
      onRequireSubscription,
      composioOAuth,
      onRefreshInstance,
      tOAuth,
    ],
  );

  const handleDisconnect = useCallback(
    async (provider: HermesIntegrationProvider) => {
      const previous = effectiveStatus(provider);

      if (previewMode) {
        setOverlay((prev) => ({ ...prev, [provider]: "connecting" }));
        await new Promise((r) => setTimeout(r, 500));
        setOverlay((prev) => ({ ...prev, [provider]: "disconnected" }));
        return;
      }

      if (!hasActiveSubscription) {
        onRequireSubscription?.();
        return;
      }

      setOverlay((prev) => ({ ...prev, [provider]: "connecting" }));

      const result = await disconnectHermesIntegrationAction({ provider });
      if (!result.ok) {
        toast.error(result.error.message ?? tOAuth("disconnectFailed"));
        setOverlay((prev) => ({ ...prev, [provider]: previous }));
        return;
      }
      setOverlay((prev) => ({ ...prev, [provider]: "disconnected" }));
      void onRefreshInstance?.();
    },
    [
      previewMode,
      hasActiveSubscription,
      onRequireSubscription,
      effectiveStatus,
      onRefreshInstance,
      tOAuth,
    ],
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
            {/* ── Assistant name (identity; leads the panel) ────── */}
            <PanelSection title={t("nameSection")} description={t("nameHelp")}>
              <div className="flex items-center gap-2">
                <input
                  id="hermes-settings-assistant-name"
                  type="text"
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  placeholder={t("namePlaceholder")}
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={60}
                  disabled={nameSaving}
                  className="border-border/60 bg-card/40 text-foreground placeholder:text-muted-foreground/60 focus-visible:ring-ring h-9 w-full rounded-lg border px-3 text-sm outline-none focus-visible:ring-2"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0 gap-1.5"
                  disabled={
                    nameSaving ||
                    nameDraft.trim().length === 0 ||
                    nameDraft.trim() === (assistantName ?? "")
                  }
                  onClick={() => void handleSaveName()}
                >
                  {nameSaving ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : null}
                  {t("nameSave")}
                </Button>
              </div>
            </PanelSection>

            {/* ── Orb colour (identity; the only place to re-pick it
                 after setup) ────────────────────────────────────── */}
            <PanelSection
              title={t("lookSection")}
              description={t("lookHelp")}
              trailing={
                orbSaving ? (
                  <Loader2
                    className="text-muted-foreground size-3.5 animate-spin"
                    aria-hidden
                  />
                ) : null
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handlePickOrb(null)}
                  aria-pressed={orbDraft === null}
                  aria-label={tOnboarding("orbWhiteLabel")}
                  disabled={orbSaving}
                  className={cn(
                    "focus-visible:ring-primary/40 rounded-full p-0.5 outline-none transition-all focus-visible:ring-2",
                    orbDraft === null
                      ? "ring-primary ring-offset-background ring-2 ring-offset-2"
                      : "ring-border/60 hover:ring-foreground/30 ring-1",
                  )}
                >
                  <PlaceholderOrb size={80} className="size-9" />
                </button>
                {orbSeeds.map((seed, index) => (
                  <button
                    key={seed}
                    type="button"
                    onClick={() => void handlePickOrb(seed)}
                    aria-pressed={seed === orbDraft}
                    aria-label={tOnboarding("orbOptionLabel", {
                      index: index + 1,
                    })}
                    disabled={orbSaving}
                    className={cn(
                      "focus-visible:ring-primary/40 rounded-full p-0.5 outline-none transition-all focus-visible:ring-2",
                      seed === orbDraft
                        ? "ring-primary ring-offset-background ring-2 ring-offset-2"
                        : "ring-border/60 hover:ring-foreground/30 ring-1",
                    )}
                  >
                    <AuroraOrb seed={seed} size={80} className="size-9" />
                  </button>
                ))}
              </div>
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

            {/* ── Personality is setup-only (no PATCH today) ───── */}
            <PanelSection
              title={t("personalitySection")}
              description={t("personalitySetupOnly")}
            />

            {/* ── Skills (skills.sh marketplace) ───────────────── */}
            {!previewMode ? (
              <SkillsMarketplace
                variant="settings"
                hasActiveSubscription={hasActiveSubscription}
                onRequireSubscription={onRequireSubscription}
              />
            ) : null}

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
