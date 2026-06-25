"use client";

import {
  ArrowLeft,
  ArrowRight,
  Briefcase as BriefcaseIcon,
  Building2,
  Check,
  Loader2,
  User as UserIcon,
} from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import type { ComponentType } from "react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import ConnectInterstitial from "@/app/hermes/components/connect-interstitial";
import FlowBackground from "@/app/hermes/components/flow-background";
import { hermesOAuthConnectErrorMessage } from "@/app/hermes/components/hermes-oauth-messages";
import ProgressPips from "@/app/hermes/components/progress-pips";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { disconnectHermesIntegrationAction } from "@/lib/actions/hermes";
import type {
  HermesAutonomyLevel,
  HermesIntegration,
  HermesIntegrationProvider,
  HermesIntegrationStatus,
} from "@/lib/hermes/types";
import { orderedMessageList } from "@/lib/intl/ordered-message-list";
import { cn } from "@/lib/utils";

import AutonomySelector from "./autonomy-selector";
import SkillsMarketplace from "./skills-marketplace";
import { useComposioOAuth } from "./use-composio-oauth";

interface OnboardingScreenProps {
  defaultName: string;
  /**
   * Session email — passed straight through to the orchestrator as-is.
   * The user doesn't get to edit it (we already verified it on signup) so
   * it isn't rendered as a field anymore, just forwarded silently.
   */
  defaultEmail: string;
  integrations: HermesIntegration[];
  previewMode: boolean;
  /** True while the parent is awaiting `POST /me/instance/onboard`. */
  isStarting?: boolean;
  onContinue: (options: {
    skipResearch: boolean;
    name: string | null;
    email: string | null;
    role: string | null;
    company: string | null;
    autonomyLevel: HermesAutonomyLevel;
  }) => void;
}

/**
 * Role options for the identity step. Plain strings (not enum-backed)
 * because the orchestrator only needs them as context for personalization —
 * Hermes doesn't switch behaviour by role, it just talks more like a peer
 * when it knows what the user does.
 */
/**
 * Ordered v1 provider list. Each `slug` matches the orchestrator's expected
 * provider string for `POST /v1/instances/:userId/integrations`.
 *
 * NOTE: Composio's `outlook` toolkit covers mail + calendar, so we render
 * three buttons. The server-side finalize handler registers a successful
 * outlook OAuth under both `outlook` and `outlook_calendar` providers.
 */
const PROVIDERS: Array<{
  slug: HermesIntegrationProvider;
  /** Path under /public for the brand SVG. */
  iconSrc: string;
  capabilityKey: "gmail" | "google_calendar" | "outlook";
}> = [
  {
    slug: "gmail",
    iconSrc: "/icons/gmail.svg",
    capabilityKey: "gmail",
  },
  {
    slug: "google_calendar",
    iconSrc: "/icons/google-calendar.svg",
    capabilityKey: "google_calendar",
  },
  {
    slug: "outlook",
    iconSrc: "/icons/outlook.svg",
    capabilityKey: "outlook",
  },
];

/** Simulated OAuth round-trip in preview mode (`?state=infrastructure_ready`). */
const PREVIEW_CONNECT_DELAY_MS = 1_400;

export default function OnboardingScreen({
  defaultName,
  defaultEmail,
  integrations,
  previewMode,
  isStarting = false,
  onContinue,
}: OnboardingScreenProps) {
  const t = useTranslations("App.Hermes.Onboarding");
  const tProviders = useTranslations("App.Hermes.Onboarding.providers");
  const tOAuth = useTranslations("App.Hermes.Common.oauth");
  const roleOptions = orderedMessageList(
    t.raw("roleOptions") as Record<string, string>,
  );
  const composioOAuth = useComposioOAuth();

  const [name, setName] = useState(defaultName);
  const [role, setRole] = useState<string>("");
  const [company, setCompany] = useState<string>("");
  const [autonomyLevel, setAutonomyLevel] =
    useState<HermesAutonomyLevel>("medium");
  /** 1 = details, 2 = autonomy, 3 = integrations, 4 = recommended skills + final CTA. */
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const TOTAL_STEPS = 4;
  const goNext = useCallback(
    () => setStep((s) => (s < TOTAL_STEPS ? ((s + 1) as 1 | 2 | 3 | 4) : s)),
    [],
  );
  const goBack = useCallback(
    () => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3 | 4) : s)),
    [],
  );

  /**
   * Local status overlay per provider. Any entry here wins over the
   * server-sourced `integrations` prop. Lets the user see "connecting…"
   * immediately while the action is in flight.
   */
  const [overlay, setOverlay] = useState<
    Partial<Record<HermesIntegrationProvider, HermesIntegrationStatus>>
  >({});

  /**
   * Pending connect attempt — populated when the user clicks a connect
   * button, drives the pre-OAuth interstitial. Cleared on confirm/cancel.
   * Heads off the "wait, why does Google want full access?" panic mid-flow.
   */
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

  const connectedCount = useMemo(() => {
    let count = 0;
    for (const { slug } of PROVIDERS) {
      if (effectiveStatus(slug) === "connected") count++;
    }
    return count;
  }, [effectiveStatus]);

  // User clicked a connect button — open the interstitial. Actual OAuth
  // fires from `runConnect` once they confirm.
  const handleConnect = useCallback(
    (provider: HermesIntegrationProvider, mode: "read" | "write" = "read") => {
      setPendingConnect({ provider, mode });
    },
    [],
  );

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
    },
    [previewMode, composioOAuth, tOAuth],
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
    },
    [previewMode, effectiveStatus],
  );

  return (
    <FlowBackground>
      <div className="mx-auto w-full max-w-2xl px-6 py-8 md:py-12">
        <ProgressPips current="setup" />

        {/* ── Hero ────────────────────────────────────────────────── */}
        <div className="mb-6 flex flex-col items-center text-center md:mb-8">
          <div className="bg-card border-border/60 ring-border/40 relative size-12 overflow-hidden rounded-full border ring-4">
            <Image
              src="/images/hermes/avatar.png"
              alt=""
              fill
              sizes="48px"
              className="object-cover"
            />
          </div>
          <h1 className="text-foreground mt-4 text-xl font-semibold tracking-tight md:text-2xl">
            {t("title")}
          </h1>
        </div>

        {/* ── Step indicator ──────────────────────────────────────── */}
        <StepIndicator
          current={step}
          total={TOTAL_STEPS}
          label={t("stepLabel", { step, total: TOTAL_STEPS })}
        />

        {/* ── Step content ────────────────────────────────────────── */}
        <div
          key={step}
          className="animate-in fade-in-0 slide-in-from-bottom-2 duration-200"
        >
          {step === 1 && (
            <Section
              heading={t("identityHeading")}
              description={t("identityHelp")}
            >
              <div className="border-border/60 bg-card/40 divide-border/60 overflow-hidden rounded-xl border divide-y">
                <InlineRow
                  htmlFor="hermes-onboarding-name"
                  Icon={UserIcon}
                  label={t("nameLabel")}
                >
                  <input
                    id="hermes-onboarding-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t("namePlaceholder")}
                    autoComplete="off"
                    spellCheck={false}
                    autoFocus
                    className="text-foreground placeholder:text-muted-foreground/60 h-9 w-full border-0 bg-transparent text-sm outline-none focus:outline-none focus:ring-0"
                  />
                </InlineRow>
                <InlineRow
                  htmlFor="hermes-onboarding-role"
                  Icon={BriefcaseIcon}
                  label={t("roleLabel")}
                >
                  <Select value={role} onValueChange={setRole}>
                    <SelectTrigger
                      id="hermes-onboarding-role"
                      className="text-foreground data-[placeholder]:text-muted-foreground/60 h-9 w-full border-0 bg-transparent px-0 text-sm shadow-none focus:ring-0 focus-visible:ring-0"
                    >
                      <SelectValue placeholder={t("rolePlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {roleOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </InlineRow>
                <InlineRow
                  htmlFor="hermes-onboarding-company"
                  Icon={Building2}
                  label={t("companyLabel")}
                >
                  <input
                    id="hermes-onboarding-company"
                    type="text"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder={t("companyPlaceholder")}
                    autoComplete="organization"
                    spellCheck={false}
                    className="text-foreground placeholder:text-muted-foreground/60 h-9 w-full border-0 bg-transparent text-sm outline-none focus:outline-none focus:ring-0"
                  />
                </InlineRow>
              </div>
            </Section>
          )}

          {step === 2 && (
            <Section
              heading={t("autonomyHeading")}
              description={t("autonomyHelp")}
            >
              <AutonomySelector
                value={autonomyLevel}
                onChange={setAutonomyLevel}
              />
            </Section>
          )}

          {step === 3 && (
            <Section
              heading={t("integrationsHeading")}
              description={t("integrationsHelp")}
            >
              <ul className="flex flex-col gap-2">
                {PROVIDERS.map(({ slug, iconSrc, capabilityKey }) => (
                  <li key={slug}>
                    <IntegrationRow
                      name={tProviders(slug)}
                      iconSrc={iconSrc}
                      capability={t(`capabilities.${capabilityKey}`)}
                      status={effectiveStatus(slug)}
                      connectedMode={
                        integrationByProvider.get(slug)?.mode ?? "read"
                      }
                      connectingLabel={t("connecting")}
                      connectedLabel={t("connected")}
                      disconnectLabel={t("disconnect")}
                      retryLabel={t("retry")}
                      onConnectReadOnly={() => void handleConnect(slug, "read")}
                      onConnectFullAccess={() =>
                        void handleConnect(slug, "write")
                      }
                      onDisconnect={() => void handleDisconnect(slug)}
                    />
                  </li>
                ))}
              </ul>

              {/* Preview of providers users can connect later from Settings.
                Tells them this isn't the full menu so they don't think these
                three are all Hermes supports. */}
              <div className="mt-6 flex flex-col gap-2.5 rounded-lg border border-dashed border-border/60 bg-card/40 px-4 py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-foreground text-xs font-medium">
                    {t("moreLaterHeading")}
                  </span>
                  <span className="text-muted-foreground text-[11px]">
                    {t("moreLaterHelp")}
                  </span>
                </div>
                <ul className="flex flex-wrap items-center gap-2">
                  {[
                    { slug: "slack", src: "/icons/slack.svg" },
                    { slug: "teams", src: "/icons/teams.svg" },
                    { slug: "linear", src: "/icons/linear.svg" },
                    { slug: "jira", src: "/icons/jira.svg" },
                    { slug: "github", src: "/icons/github.svg" },
                    { slug: "notion", src: "/icons/notion.svg" },
                    { slug: "google_sheets", src: "/icons/google-sheets.svg" },
                    { slug: "google_docs", src: "/icons/google-docs.svg" },
                    { slug: "hubspot", src: "/icons/hubspot.svg" },
                    { slug: "twitter", src: "/icons/x.svg" },
                    { slug: "linkedin", src: "/icons/linkedin.svg" },
                    { slug: "instagram", src: "/icons/instagram.svg" },
                    { slug: "youtube", src: "/icons/youtube.svg" },
                  ].map(({ slug, src }) => (
                    <li
                      key={slug}
                      title={tProviders(slug)}
                      className="border-border/60 bg-background flex items-center gap-1.5 rounded-md border px-2 py-1"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt="" className="size-3.5" />
                      <span className="text-muted-foreground text-[11px]">
                        {tProviders(slug)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </Section>
          )}

          {step === 4 && (
            <Section heading={t("skillsHeading")} description={t("skillsHelp")}>
              {!previewMode ? <SkillsMarketplace variant="onboarding" /> : null}
            </Section>
          )}
        </div>

        {/* ── Wizard navigation ───────────────────────────────────── */}
        <div className="mt-8 flex flex-col items-center gap-3 md:mt-10">
          {step < TOTAL_STEPS ? (
            <div className="flex w-full max-w-md items-center justify-between gap-3">
              <Button
                type="button"
                size="lg"
                variant="ghost"
                className="gap-2"
                disabled={step === 1}
                onClick={goBack}
              >
                <ArrowLeft className="size-4" aria-hidden />
                <span>{t("back")}</span>
              </Button>
              <Button
                type="button"
                size="lg"
                variant="primary"
                className="gap-2"
                onClick={goNext}
              >
                <span>{t("next")}</span>
                <ArrowRight className="size-4" aria-hidden />
              </Button>
            </div>
          ) : (
            <>
              <div className="flex w-full max-w-md items-center justify-between gap-3">
                <Button
                  type="button"
                  size="lg"
                  variant="ghost"
                  className="gap-2"
                  disabled={isStarting}
                  onClick={goBack}
                >
                  <ArrowLeft className="size-4" aria-hidden />
                  <span>{t("back")}</span>
                </Button>
                <Button
                  type="button"
                  size="lg"
                  variant="primary"
                  className="gap-2"
                  disabled={isStarting}
                  aria-busy={isStarting}
                  onClick={() =>
                    onContinue({
                      skipResearch: false,
                      name: name.trim() || null,
                      email: defaultEmail || null,
                      role: role.trim() || null,
                      company: company.trim() || null,
                      autonomyLevel,
                    })
                  }
                >
                  {isStarting ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : null}
                  <span>{t("continueCta")}</span>
                  {!isStarting ? (
                    <ArrowRight className="size-4" aria-hidden />
                  ) : null}
                </Button>
              </div>
              <p className="text-muted-foreground/80 text-center text-xs">
                {connectedCount === 0
                  ? t("footnote")
                  : t("continueWithCount", { count: connectedCount })}
              </p>
              <div className="border-border/60 mt-2 flex w-full max-w-xs flex-col items-center gap-1 border-t pt-4">
                <button
                  type="button"
                  disabled={isStarting}
                  className="text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-50 text-sm transition-colors"
                  onClick={() =>
                    onContinue({
                      // If the user actually connected an integration before
                      // hitting "skip for now" we still want the deep
                      // inbox-aware research path — otherwise we'd waste the
                      // signal they just gave us. `skipResearch` only buys
                      // the user a faster (shallow) cold start when there's
                      // genuinely nothing to read from.
                      skipResearch: connectedCount === 0,
                      name: name.trim() || null,
                      email: defaultEmail || null,
                      role: role.trim() || null,
                      company: company.trim() || null,
                      autonomyLevel,
                    })
                  }
                >
                  {t("skipCta")}
                </button>
                <p className="text-muted-foreground/60 max-w-xs text-center text-xs leading-relaxed">
                  {t("skipCtaHelp")}
                </p>
              </div>
            </>
          )}
        </div>

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
      </div>
    </FlowBackground>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Section({
  heading,
  description,
  children,
}: {
  heading: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6 md:mt-8">
      <h2 className="text-foreground text-base font-medium">{heading}</h2>
      {description && (
        <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
          {description}
        </p>
      )}
      <div className="mt-5">{children}</div>
    </section>
  );
}

/**
 * Wizard step indicator — mono "Step N of M" + a thin segmented bar. Filled
 * segments show progress; the active segment is the one matching `current`.
 * Deliberately quiet so it doesn't compete with the actual step content.
 */
function StepIndicator({
  current,
  total,
  label,
}: {
  current: number;
  total: number;
  label: string;
}) {
  return (
    <div className="mb-6 flex flex-col items-center gap-2">
      <span className="text-tertiary-foreground font-mono text-[10px] font-semibold uppercase tracking-wider tabular-nums">
        {label}
      </span>
      <div aria-hidden className="flex w-full max-w-xs items-center gap-1.5">
        {Array.from({ length: total }, (_, i) => {
          const idx = i + 1;
          const filled = idx <= current;
          const active = idx === current;
          return (
            <span
              key={idx}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                active
                  ? "bg-foreground"
                  : filled
                    ? "bg-foreground/40"
                    : "bg-border",
              )}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * Identity-step form row: borderless input/select inside a shared card so the
 * three fields read as one designed object instead of three stacked inputs.
 * Icon tile on the left, fixed-width label column, then the control fills the
 * rest. Focus state lives on the row's bg, not on the child input, so the
 * Select trigger and the bare <input> share the same hit treatment.
 */
function InlineRow({
  htmlFor,
  Icon,
  label,
  children,
}: {
  htmlFor: string;
  Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="focus-within:bg-muted/40 flex items-center gap-3 px-4 py-2 transition-colors">
      <span
        aria-hidden
        className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-md"
      >
        <Icon className="size-3.5" aria-hidden />
      </span>
      <Label
        htmlFor={htmlFor}
        className="text-muted-foreground w-20 shrink-0 cursor-pointer text-xs font-medium uppercase tracking-wider"
      >
        {label}
      </Label>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

interface IntegrationRowProps {
  name: string;
  iconSrc: string;
  capability: string;
  status: HermesIntegrationStatus;
  connectedMode: "read" | "write";
  connectingLabel: string;
  connectedLabel: string;
  disconnectLabel: string;
  retryLabel: string;
  onConnectReadOnly: () => void;
  onConnectFullAccess: () => void;
  onDisconnect: () => void;
}

function IntegrationRow({
  name,
  iconSrc,
  capability,
  status,
  connectedMode,
  connectingLabel,
  connectedLabel,
  disconnectLabel,
  retryLabel,
  onConnectReadOnly,
  onConnectFullAccess,
  onDisconnect,
}: IntegrationRowProps) {
  const t = useTranslations("App.Hermes.Onboarding");
  const tCommon = useTranslations("App.Hermes.Common");
  const isConnected = status === "connected";
  const isConnecting = status === "connecting";
  const isError = status === "error";
  const [showFullAccess, setShowFullAccess] = useState(false);

  return (
    <div
      className={cn(
        "border-border/60 bg-card/40 group rounded-lg border p-4 transition-colors",
        "hover:bg-card",
        isConnected && "bg-card",
      )}
    >
      <div className="flex items-center gap-4">
        <div
          aria-hidden
          className="bg-background border-border/60 flex size-10 shrink-0 items-center justify-center rounded-lg border"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={iconSrc} alt="" className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-foreground truncate text-sm font-medium">
            {name}
          </div>
          <div className="text-muted-foreground line-clamp-2 text-xs leading-snug">
            {isConnected
              ? capability
              : isConnecting
                ? connectingLabel
                : isError
                  ? t("connectError")
                  : capability}
          </div>
        </div>
        {isConnecting ? (
          <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            <span>{connectingLabel}</span>
          </span>
        ) : isConnected ? (
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                connectedMode === "write"
                  ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                  : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
              )}
            >
              <Check className="size-3" aria-hidden />
              {connectedMode === "write"
                ? t("connectedFullAccess", { label: connectedLabel })
                : t("connectedReadOnly", { label: connectedLabel })}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onDisconnect}
              className="text-muted-foreground hover:text-foreground text-xs"
            >
              {disconnectLabel}
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant={isError ? "outline" : "primary"}
            size="sm"
            onClick={onConnectReadOnly}
          >
            {isError ? retryLabel : t("connectReadOnly")}
          </Button>
        )}
      </div>

      {/* Full-access disclosure — only when disconnected. Hidden behind a
          collapsed link so it never visually competes with the primary,
          safer read-only CTA. */}
      {!isConnected && !isConnecting ? (
        <div className="border-border/60 mt-3 border-t pt-3 pl-14">
          {showFullAccess ? (
            <div className="flex flex-col gap-2">
              <p className="text-muted-foreground text-xs leading-relaxed">
                {t("fullAccessBodyPrefix")}{" "}
                <strong className="text-foreground">
                  {t("fullAccessBodyBold")}
                </strong>
                . {t("fullAccessBodySuffix")}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onConnectFullAccess}
                >
                  {t("fullAccessCta")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowFullAccess(false)}
                  className="text-muted-foreground hover:text-foreground text-xs"
                >
                  {tCommon("cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowFullAccess(true)}
              className="text-muted-foreground hover:text-foreground text-xs transition-colors"
            >
              {t("fullAccessPrompt")}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
