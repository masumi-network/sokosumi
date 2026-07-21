"use client";

import {
  ArrowLeft,
  ArrowRight,
  Blocks,
  Check,
  Gauge,
  Loader2,
  Plug,
  Sparkles,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import ConnectInterstitial from "@/app/personal-assistant/components/connect-interstitial";
import FlowBackground from "@/app/personal-assistant/components/flow-background";
import { hermesOAuthConnectErrorMessage } from "@/app/personal-assistant/components/hermes-oauth-messages";
import ProgressPips from "@/app/personal-assistant/components/progress-pips";
import { AuroraOrb, PlaceholderOrb } from "@/components/aurora-orb";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { disconnectHermesIntegrationAction } from "@/lib/actions/hermes";
import { orbCandidateSeeds } from "@/lib/aurora-orb";
import { personalityToOrbMotion } from "@/lib/hermes/personality-orb";
import type {
  HermesAutonomyLevel,
  HermesIntegration,
  HermesIntegrationProvider,
  HermesIntegrationStatus,
  HermesPersonality,
} from "@/lib/hermes/types";
import { cn } from "@/lib/utils";

import AutonomySelector from "./autonomy-selector";
import SkillsMarketplace from "./skills-marketplace";
import { useComposioOAuth } from "./use-composio-oauth";

interface OnboardingScreenProps {
  defaultName: string;
  /** Base seed for the orb-picker candidates (per-user — makes them unique). */
  orbBaseSeed: string;
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
  /** Paid coverage — gates skill installs on the Skills step so a lapsed
   * subscription opens the wall instead of a raw Core 403 toast. */
  hasActiveSubscription?: boolean;
  onRequireSubscription?: () => void;
  onContinue: (options: {
    skipResearch: boolean;
    name: string | null;
    assistantName: string | null;
    avatarSeed: string | null;
    personality: HermesPersonality;
    email: string | null;
    role: string | null;
    company: string | null;
    autonomyLevel: HermesAutonomyLevel;
  }) => void;
}

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

const DEFAULT_PERSONALITY: HermesPersonality = {
  tone: 50,
  detail: 50,
  style: 50,
};

/**
 * The three personality spectrums. Each maps to a 0–100 slider; the end labels
 * come from i18n. Keys line up with `HermesPersonality` and the orchestrator
 * contract.
 */
const PERSONALITY_DIMENSIONS = [
  {
    key: "tone",
    labelKey: "personalityToneLabel",
    lowKey: "personalityToneLow",
    highKey: "personalityToneHigh",
  },
  {
    key: "detail",
    labelKey: "personalityDetailLabel",
    lowKey: "personalityDetailLow",
    highKey: "personalityDetailHigh",
  },
  {
    key: "style",
    labelKey: "personalityStyleLabel",
    lowKey: "personalityStyleLow",
    highKey: "personalityStyleHigh",
  },
] as const;

export default function OnboardingScreen({
  defaultName,
  orbBaseSeed,
  defaultEmail,
  integrations,
  previewMode,
  isStarting = false,
  hasActiveSubscription = true,
  onRequireSubscription,
  onContinue,
}: OnboardingScreenProps) {
  const t = useTranslations("App.Hermes.Onboarding");
  const tSkillsPanel = useTranslations("App.Hermes.SkillsPanel");
  const tProviders = useTranslations("App.Hermes.Onboarding.providers");
  const tOAuth = useTranslations("App.Hermes.Common.oauth");
  const composioOAuth = useComposioOAuth();

  const [assistantName, setAssistantName] = useState<string>("");
  // null until the user explicitly picks a colour — until then the orb stays
  // the white placeholder everywhere (the "standard" look).
  const [selectedOrbIndex, setSelectedOrbIndex] = useState<number | null>(null);
  // The full curated palette (anchors + pastel + jewel tiers), salted with
  // the user's id so the face traits stay unique to them.
  const orbSeeds = useMemo(() => orbCandidateSeeds(orbBaseSeed), [orbBaseSeed]);
  const selectedSeed =
    selectedOrbIndex !== null ? (orbSeeds[selectedOrbIndex] ?? null) : null;
  const [personality, setPersonality] =
    useState<HermesPersonality>(DEFAULT_PERSONALITY);
  const [autonomyLevel, setAutonomyLevel] =
    useState<HermesAutonomyLevel>("medium");
  // Skills added during step 5 (user-managed installed count from the
  // pre-warmed marketplace). Review step recaps this without another fetch.
  const [skillsInstalledCount, setSkillsInstalledCount] = useState(0);
  const handleSkillsInstalledCountChange = useCallback((count: number) => {
    setSkillsInstalledCount(count);
  }, []);
  /** 1 = name, 2 = look + personality, 3 = autonomy, 4 = tools, 5 = skills, 6 = review. */
  type Step = 1 | 2 | 3 | 4 | 5 | 6;
  const [step, setStep] = useState<Step>(1);
  const TOTAL_STEPS = 6;
  const goNext = useCallback(
    () => setStep((s) => (s < TOTAL_STEPS ? ((s + 1) as Step) : s)),
    [],
  );
  const goBack = useCallback(
    () => setStep((s) => (s > 1 ? ((s - 1) as Step) : s)),
    [],
  );

  // ── Orb animation driven by the chosen personality ───────────────────────
  // Playful + warm → faster, livelier motion; detail makes the movement more
  // deliberate. Applied from the combined look/personality step on, so dragging
  // the sliders visibly changes how the orb animates. The chat reuses the same
  // mapping so they match.
  const { speed: personalitySpeed, restExpression: personalityExpr } =
    personalityToOrbMotion(personality);
  const heroExpression =
    step === 1
      ? assistantName.trim()
        ? "idle"
        : null
      : step === TOTAL_STEPS
        ? "happy"
        : personalityExpr;
  const heroSpeed = step >= 2 ? personalitySpeed : 1.3;
  const [heroEvent, setHeroEvent] = useState<{
    expr: "happy";
    nonce: number;
    ms: number;
  } | null>(null);
  const heroEventNonce = useRef(0);
  useEffect(() => {
    if (step !== TOTAL_STEPS) return;
    heroEventNonce.current += 1;
    setHeroEvent({
      expr: "happy",
      nonce: heroEventNonce.current,
      ms: 1400,
    });
  }, [step]);

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
      <div className="mx-auto w-full max-w-2xl px-6 py-5 md:py-7">
        <ProgressPips current="setup" />

        {/* ── Hero ────────────────────────────────────────────────────
            The white placeholder orb until the user picks a colour on the Look
            step, then it "takes form" into the chosen orb (keyed crossfade).
            Its speed + expression follow the chosen personality. */}
        <div
          className={cn(
            "mb-4 flex flex-col items-center text-center md:mb-5",
            step === 2 && "max-md:hidden",
          )}
        >
          <div
            key={selectedSeed === null ? "placeholder" : "chosen"}
            className="animate-in fade-in zoom-in-95 duration-500"
          >
            {selectedSeed === null ? (
              <PlaceholderOrb
                size={160}
                speed={heroSpeed}
                expression={heroExpression}
                event={heroEvent}
                className="size-20 md:size-24"
              />
            ) : (
              <AuroraOrb
                seed={selectedSeed}
                size={160}
                animate
                speed={heroSpeed}
                expression={heroExpression}
                event={heroEvent}
                className="size-20 md:size-24"
              />
            )}
          </div>
          <h1 className="text-foreground mt-3 text-xl font-light tracking-tight md:text-2xl">
            {t("title")}
          </h1>
        </div>

        {/* ── Step indicator ──────────────────────────────────────── */}
        <StepIndicator
          current={step}
          total={TOTAL_STEPS}
          label={t("stepLabel", { step, total: TOTAL_STEPS })}
        />

        {/* ── Step content ────────────────────────────────────────────
            Anchored to a fixed min-height + vertically centered so the Back /
            Next buttons land at the same Y on every step and the cursor
            doesn't chase them. */}
        <div
          key={step}
          className={cn(
            "animate-in fade-in-0 slide-in-from-bottom-2 flex min-h-[19rem] flex-col justify-center duration-200",
            step === 5 && "hidden",
          )}
        >
          {step === 1 && (
            <Section
              heading={t("nameStepHeading")}
              description={t("nameStepHelp")}
            >
              <div className="mx-auto flex max-w-sm flex-col items-center">
                <input
                  id="hermes-onboarding-assistant-name"
                  type="text"
                  value={assistantName}
                  onChange={(e) => setAssistantName(e.target.value)}
                  placeholder={t("assistantNamePlaceholder")}
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={60}
                  autoFocus
                  className="border-border/60 bg-card/40 text-foreground placeholder:text-muted-foreground/50 focus:border-foreground/40 focus:bg-card h-14 w-full rounded-xl border px-5 text-center text-lg font-light tracking-tight outline-none transition-colors focus:outline-none"
                />
              </div>
            </Section>
          )}

          {step === 2 && (
            <Section
              heading={t("lookStepHeading")}
              description={t("lookStepHelp")}
            >
              <div className="grid gap-6">
                {/* ── Colour picker. The porcelain placeholder is the standard
                    option (selected = nothing committed yet); the swatches are
                    the full curated palette, salted per user so the face stays
                    unique. The preview only changes once picked. ── */}
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedOrbIndex(null)}
                    aria-pressed={selectedOrbIndex === null}
                    aria-label={t("orbWhiteLabel")}
                    className={cn(
                      "rounded-full p-0.5 outline-none transition-all focus-visible:ring-2 focus-visible:ring-primary/40",
                      selectedOrbIndex === null
                        ? "ring-primary ring-offset-background ring-2 ring-offset-2"
                        : "ring-border/60 hover:ring-foreground/30 ring-1",
                    )}
                  >
                    <PlaceholderOrb size={96} className="size-11" />
                  </button>
                  {orbSeeds.map((s, i) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSelectedOrbIndex(i)}
                      aria-pressed={i === selectedOrbIndex}
                      aria-label={t("orbOptionLabel", { index: i + 1 })}
                      className={cn(
                        "rounded-full p-0.5 outline-none transition-all focus-visible:ring-2 focus-visible:ring-primary/40",
                        i === selectedOrbIndex
                          ? "ring-primary ring-offset-background ring-2 ring-offset-2"
                          : "ring-border/60 hover:ring-foreground/30 ring-1",
                      )}
                    >
                      <AuroraOrb seed={s} size={96} className="size-11" />
                    </button>
                  ))}
                </div>

                <PersonalitySliders
                  value={personality}
                  onChange={setPersonality}
                />
              </div>
            </Section>
          )}

          {step === 3 && (
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

          {step === 4 && (
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

              <p className="text-muted-foreground/80 mt-4 text-center text-xs leading-relaxed">
                {t("moreLaterShort")}
              </p>
            </Section>
          )}

          {step === 6 && (
            <Section heading={t("reviewHeading")} description={t("reviewHelp")}>
              <AgentReviewCard
                assistantName={assistantName.trim()}
                userName={defaultName.trim()}
                role=""
                personality={personality}
                autonomyLevel={autonomyLevel}
                connectedCount={connectedCount}
                skillsCount={skillsInstalledCount}
              />
            </Section>
          )}
        </div>

        {/* ── Step 5: skills — OUTSIDE the keyed remount container so the
            marketplace mounts once on wizard load and stays mounted. Its
            catalog fetch (which can be slow) warms in the background while
            the user works through steps 1–4, so by the time they arrive the
            shelf is already populated. Installs fire immediately; the
            orchestrator queues them and they're on the machine when setup
            finishes. */}
        <div
          className={cn(
            "min-h-[19rem] flex-col justify-center",
            step === 5
              ? "animate-in fade-in-0 slide-in-from-bottom-2 flex duration-200"
              : "hidden",
          )}
        >
          <Section heading={t("skillsHeading")} description={t("skillsHelp")}>
            {!previewMode ? (
              <SkillsMarketplace
                variant="onboarding"
                active={step === 5}
                hasActiveSubscription={hasActiveSubscription}
                onRequireSubscription={onRequireSubscription}
                onVisibleInstalledCountChange={handleSkillsInstalledCountChange}
              />
            ) : (
              <p className="text-muted-foreground text-center text-sm">
                {tSkillsPanel("previewUnavailable")}
              </p>
            )}
          </Section>
        </div>

        {/* ── Wizard navigation ───────────────────────────────────── */}
        <div className="border-border/60 bg-background/95 sticky bottom-0 z-10 -mx-6 mt-6 flex flex-col items-center gap-3 border-t px-6 py-3 backdrop-blur-md md:static md:mx-0 md:mt-8 md:border-t-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
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
                disabled={step === 1 && assistantName.trim().length === 0}
                onClick={goNext}
              >
                <span>{t("next")}</span>
                <ArrowRight className="size-4" aria-hidden />
              </Button>
            </div>
          ) : (
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
                    name: defaultName.trim() || null,
                    assistantName: assistantName.trim() || null,
                    avatarSeed: selectedSeed,
                    personality,
                    email: defaultEmail || null,
                    role: null,
                    company: null,
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
      <h2 className="text-foreground text-center text-base font-medium">
        {heading}
      </h2>
      {description && (
        <p className="text-muted-foreground mx-auto mt-1.5 max-w-md text-center text-sm leading-relaxed">
          {description}
        </p>
      )}
      <div className="mt-5">{children}</div>
    </section>
  );
}

/**
 * Three personality spectrums (tone · detail · style) as 0–100 sliders,
 * quantized to five stops (0/25/50/75/100) — coarse enough to feel like a
 * choice, not a dial. The values are sent to the orchestrator, which folds
 * them into the assistant's system prompt. End labels make each spectrum
 * self-explanatory; 50 = balanced.
 */
function PersonalitySliders({
  value,
  onChange,
}: {
  value: HermesPersonality;
  onChange: (next: HermesPersonality) => void;
}) {
  const t = useTranslations("App.Hermes.Onboarding");
  return (
    <div className="border-border/60 bg-card/40 flex flex-col gap-6 rounded-xl border p-5">
      <div className="flex flex-col gap-1">
        <h3 className="text-foreground text-sm font-semibold">
          {t("personalityHeading")}
        </h3>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {t("personalityStepHelp")}
        </p>
      </div>
      {PERSONALITY_DIMENSIONS.map((dim) => (
        <div key={dim.key} className="flex flex-col gap-2.5">
          <span className="text-foreground text-sm font-medium">
            {t(dim.labelKey)}
          </span>
          <Slider
            value={[value[dim.key]]}
            min={0}
            max={100}
            step={25}
            aria-label={t(dim.labelKey)}
            onValueChange={(next) =>
              onChange({ ...value, [dim.key]: next[0] ?? 50 })
            }
          />
          <div className="text-muted-foreground flex items-center justify-between text-xs">
            <span>{t(dim.lowKey)}</span>
            <span>{t(dim.highKey)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

const AUTONOMY_LABEL_KEYS = {
  low: "autonomyLowLabel",
  medium: "autonomyMediumLabel",
  high: "autonomyHighLabel",
} as const satisfies Record<HermesAutonomyLevel, string>;

/**
 * Premium "meet your assistant" card for the final review step — the orb, the
 * agent's name, whose assistant it is + its focus, and a recap of personality,
 * initiative, connected tools, and skills added on step 5. The reveal that
 * closes setup.
 */
function AgentReviewCard({
  assistantName,
  userName,
  role,
  personality,
  autonomyLevel,
  connectedCount,
  skillsCount,
}: {
  assistantName: string;
  userName: string;
  role: string;
  personality: HermesPersonality;
  autonomyLevel: HermesAutonomyLevel;
  connectedCount: number;
  skillsCount: number;
}) {
  const t = useTranslations("App.Hermes.Onboarding");

  const traits: string[] = [];
  if (personality.tone <= 33) traits.push(t("personalityToneLow"));
  else if (personality.tone >= 67) traits.push(t("personalityToneHigh"));
  if (personality.detail <= 33) traits.push(t("personalityDetailLow"));
  else if (personality.detail >= 67) traits.push(t("personalityDetailHigh"));
  if (personality.style <= 33) traits.push(t("personalityStyleLow"));
  else if (personality.style >= 67) traits.push(t("personalityStyleHigh"));
  const descriptor =
    traits.length > 0 ? traits.join(" · ") : t("personalityBalanced");

  const owner = userName
    ? t("reviewOwnedBy", { name: userName })
    : t("reviewGeneric");
  const subtitle = role ? `${owner} · ${t("reviewFocus", { role })}` : owner;

  const rows = [
    { Icon: Sparkles, label: t("reviewPersonality"), value: descriptor },
    {
      Icon: Gauge,
      label: t("reviewAutonomy"),
      value: t(AUTONOMY_LABEL_KEYS[autonomyLevel]),
    },
    {
      Icon: Plug,
      label: t("reviewTools"),
      value:
        connectedCount > 0
          ? t("reviewToolsCount", { count: connectedCount })
          : t("reviewToolsNone"),
    },
    {
      Icon: Blocks,
      label: t("reviewSkills"),
      value:
        skillsCount > 0
          ? t("reviewSkillsCount", { count: skillsCount })
          : t("reviewSkillsNone"),
    },
  ];

  return (
    <div className="border-border/60 bg-card mx-auto max-w-md overflow-hidden rounded-2xl border">
      <div className="flex flex-col items-center px-6 pt-6 pb-5 text-center">
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
          {t("reviewMeet")}
        </p>
        <h3 className="text-foreground mt-1 text-2xl font-light tracking-tight">
          {assistantName || t("assistantFallbackName")}
        </h3>
        <p className="text-muted-foreground mt-1.5 text-sm">{subtitle}</p>
      </div>
      <dl className="divide-border/60 border-border/60 divide-y border-t">
        {rows.map(({ Icon, label, value }) => (
          <div key={label} className="flex items-center gap-3 px-6 py-3.5">
            <Icon
              className="text-muted-foreground size-4 shrink-0"
              aria-hidden
            />
            <dt className="text-muted-foreground w-24 shrink-0 text-xs font-medium uppercase tracking-wider">
              {label}
            </dt>
            <dd className="text-foreground min-w-0 flex-1 truncate text-right text-sm font-medium">
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
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
      <span className="text-tertiary-foreground font-mono text-xs font-semibold uppercase tracking-wider tabular-nums">
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
