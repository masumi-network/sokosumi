"use client";

import {
  ArrowRight,
  Check,
  Gauge,
  ListTodo,
  Loader2,
  Lock,
  Mail,
  Moon,
  Plug,
  Repeat,
  ShieldAlert,
  Sparkles,
  Wand2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { type ComponentType, createContext, useContext, useState } from "react";

import FlowBackground from "@/app/hermes/components/flow-background";
import { AuroraOrb, PlaceholderOrb } from "@/components/aurora-orb";
import { Button } from "@/components/ui/button";
import { orderedMessageList } from "@/lib/intl/ordered-message-list";
import { cn } from "@/lib/utils";

/** The assistant's orb seed, shared with the journey-visual sub-components
 * (referenced via a data array, so prop-threading would be awkward). */
const EmptyStateSeedContext = createContext<string>("personal-assistant");

interface EmptyStateProps {
  onActivate: () => void;
  /** Orb seed for the assistant avatar. */
  seed: string;
}

const SERVICE_LOGOS: Array<{
  src: string;
  labelKey:
    | "gmail"
    | "outlook"
    | "google_calendar"
    | "google_sheets"
    | "google_docs"
    | "slack"
    | "teams"
    | "notion"
    | "linear"
    | "jira"
    | "github"
    | "hubspot"
    | "twitter"
    | "linkedin";
}> = [
  { src: "/icons/gmail.svg", labelKey: "gmail" },
  { src: "/icons/outlook.svg", labelKey: "outlook" },
  { src: "/icons/google-calendar.svg", labelKey: "google_calendar" },
  { src: "/icons/google-sheets.svg", labelKey: "google_sheets" },
  { src: "/icons/google-docs.svg", labelKey: "google_docs" },
  { src: "/icons/slack.svg", labelKey: "slack" },
  { src: "/icons/teams.svg", labelKey: "teams" },
  { src: "/icons/notion.svg", labelKey: "notion" },
  { src: "/icons/linear.svg", labelKey: "linear" },
  { src: "/icons/jira.svg", labelKey: "jira" },
  { src: "/icons/github.svg", labelKey: "github" },
  { src: "/icons/hubspot.svg", labelKey: "hubspot" },
  { src: "/icons/x.svg", labelKey: "twitter" },
  { src: "/icons/linkedin.svg", labelKey: "linkedin" },
];

/**
 * The end-to-end journey shown on the empty state. Each step renders a
 * compact card: number + copy above a composed visualization. The
 * visualizations are intentionally
 * borders-dominant — color is reserved for status (active dot, success
 * check) so the rhythm stays calm across the page.
 */
const JOURNEY: Array<{
  tagKey: string;
  titleKey: string;
  bodyKey: string;
  Visual: ComponentType;
  accentText: string;
  accentRing: string;
}> = [
  {
    tagKey: "journeyStep1Tag",
    titleKey: "journeyStep1Title",
    bodyKey: "journeyStep1Body",
    Visual: ActivationVisual,
    accentText: "text-primary",
    accentRing: "border-primary/40",
  },
  {
    tagKey: "journeyStep3Tag",
    titleKey: "journeyStep3Title",
    bodyKey: "journeyStep3Body",
    Visual: ConnectionVisual,
    accentText: "text-primary",
    accentRing: "border-primary/40",
  },
  {
    tagKey: "journeyStep5Tag",
    titleKey: "journeyStep5Title",
    bodyKey: "journeyStep5Body",
    Visual: ActVisual,
    accentText: "text-primary",
    accentRing: "border-primary/40",
  },
];

const FEATURES: Array<{
  titleKey: string;
  bodyKey: string;
  Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  /** Tailwind classes for the icon tile — varied per feature for texture. */
  accent: string;
  /** Span 2 columns on lg+ — used to break the monotonous grid. */
  hero?: boolean;
}> = [
  {
    titleKey: "feature2Title",
    bodyKey: "feature2Body",
    Icon: Sparkles,
    accent: "bg-muted/40 text-muted-foreground",
  },
  {
    titleKey: "feature4Title",
    bodyKey: "feature4Body",
    Icon: Lock,
    accent: "bg-muted/40 text-muted-foreground",
  },
  {
    titleKey: "feature5Title",
    bodyKey: "feature5Body",
    Icon: Moon,
    accent: "bg-muted/40 text-muted-foreground",
  },
  {
    titleKey: "feature6Title",
    bodyKey: "feature6Body",
    Icon: Plug,
    accent: "bg-muted/40 text-muted-foreground",
  },
];

type ExampleKey = "example1" | "example3" | "example4";

const EXAMPLES: Array<{
  key: ExampleKey;
  /** i18n key for the mocked Hermes reply (markdown-lite). */
  replyKey: `${ExampleKey}Reply`;
  categoryKey: ExampleKey;
  Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}> = [
  {
    key: "example1",
    replyKey: "example1Reply",
    categoryKey: "example1",
    Icon: Mail,
  },
  {
    key: "example3",
    replyKey: "example3Reply",
    categoryKey: "example3",
    Icon: Repeat,
  },
  {
    key: "example4",
    replyKey: "example4Reply",
    categoryKey: "example4",
    Icon: ListTodo,
  },
];

export default function EmptyState({ onActivate, seed }: EmptyStateProps) {
  const t = useTranslations("App.Hermes.EmptyState");
  const tCommon = useTranslations("App.Hermes.Common");
  const tServices = useTranslations("App.Hermes.EmptyState.serviceLabels");

  return (
    <EmptyStateSeedContext.Provider value={seed}>
      <FlowBackground>
        <div className="mx-auto w-full max-w-6xl px-2 pb-8">
          {/* ── Hero ──────────────────────────────────────────────── */}
          <section className="grid gap-4 py-4 md:py-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="border-border/60 bg-card/80 overflow-hidden rounded-2xl border">
              <div className="grid gap-6 p-6 md:grid-cols-[auto_minmax(0,1fr)] md:p-8">
                <div className="relative flex size-28 shrink-0 items-center justify-center md:size-32">
                  <div
                    aria-hidden
                    className="bg-primary/10 absolute inset-0 rounded-full blur-2xl"
                  />
                  <PlaceholderOrb
                    size={176}
                    expression="idle"
                    className="relative size-24 md:size-28"
                    alt={tCommon("hermesAvatarAlt")}
                  />
                </div>

                <div className="min-w-0">
                  <div className="text-primary text-xs font-semibold uppercase tracking-wider">
                    {t("eyebrow")}
                  </div>
                  <h1 className="text-foreground mt-3 max-w-3xl text-3xl font-light tracking-tight md:text-5xl">
                    {t("title")}
                  </h1>
                  <p className="text-foreground/80 mt-4 max-w-2xl text-base leading-relaxed md:text-lg">
                    {t("subtitle")}
                  </p>
                  <p className="text-muted-foreground mt-3 max-w-2xl text-sm leading-relaxed md:text-base">
                    {t("description")}
                  </p>

                  <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                    <Button
                      size="lg"
                      variant="primary"
                      className="h-11 gap-2 px-5"
                      onClick={onActivate}
                    >
                      <span>{t("primaryCta")}</span>
                      <ArrowRight className="size-4" aria-hidden />
                    </Button>
                    <a
                      href="#hermes-examples"
                      className="border-border bg-background text-foreground hover:bg-muted/50 inline-flex h-11 items-center justify-center rounded-md border px-4 text-sm font-medium transition-colors"
                    >
                      {t("examplesEyebrow")}
                    </a>
                  </div>
                </div>
              </div>

              <div className="border-border/60 bg-muted/20 grid gap-px border-t md:grid-cols-3">
                {JOURNEY.map((step, index) => (
                  <a
                    key={step.titleKey}
                    href={`#hermes-step-${index + 1}`}
                    className="bg-card/70 hover:bg-card group flex items-center gap-3 px-5 py-4 transition-colors"
                  >
                    <span className="border-border bg-background text-muted-foreground group-hover:text-foreground inline-flex size-8 shrink-0 items-center justify-center rounded-full border font-mono text-xs font-semibold tabular-nums transition-colors">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0">
                      <span className="text-muted-foreground block text-[11px] font-semibold uppercase tracking-wider">
                        {t(step.tagKey)}
                      </span>
                      <span className="text-foreground block truncate text-sm font-medium">
                        {t(step.titleKey)}
                      </span>
                    </span>
                  </a>
                ))}
              </div>
            </div>

            <ActivationBrief />
          </section>

          <nav
            aria-label={t("title")}
            className="border-border/60 bg-card/70 sticky top-2 z-10 mb-8 flex gap-1 overflow-x-auto rounded-xl border p-1 backdrop-blur-md [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {[
              { href: "#hermes-integrations", label: t("integrationsEyebrow") },
              { href: "#hermes-journey", label: t("journeyEyebrow") },
              { href: "#hermes-features", label: t("featuresEyebrow") },
              { href: "#hermes-examples", label: t("examplesEyebrow") },
              { href: "#hermes-safeguards", label: t("disclaimerHeading") },
            ].map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="text-muted-foreground hover:bg-muted/50 hover:text-foreground whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors"
              >
                {item.label}
              </a>
            ))}
          </nav>

          {/* ── Services strip ─────────────────────────────────────── */}
          <Section
            id="hermes-integrations"
            eyebrow={t("integrationsEyebrow")}
            eyebrowColor="text-primary"
            heading={t("servicesHeading")}
            description={t("servicesHelp")}
            marginTop="mt-8"
          >
            <div className="border-border/60 bg-card/80 rounded-2xl border p-5 md:p-6">
              <ul className="flex flex-wrap items-center justify-center gap-2.5 sm:gap-3">
                {SERVICE_LOGOS.map(({ src, labelKey }) => (
                  <li
                    key={labelKey}
                    className="border-border/60 bg-background group flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 transition-colors hover:border-foreground/30 hover:bg-muted/30"
                    title={tServices(labelKey)}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt="" className="size-5 shrink-0" />
                    <span className="text-foreground text-sm font-medium">
                      {tServices(labelKey)}
                    </span>
                  </li>
                ))}
                <li className="border-border/40 text-muted-foreground flex items-center rounded-xl border border-dashed px-3.5 py-2.5 text-sm">
                  {t("servicesMoreLabel")}
                </li>
              </ul>
            </div>
          </Section>

          {/* ── Journey — end-to-end step-by-step ─────────────────── */}
          <Section
            id="hermes-journey"
            eyebrow={t("journeyEyebrow")}
            eyebrowColor="text-primary"
            heading={t("journeyHeading")}
            description={t("journeyDescription")}
            marginTop="mt-12 md:mt-16"
          >
            <ol className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {JOURNEY.map((step, idx) => (
                <JourneyRow key={step.titleKey} step={step} index={idx} />
              ))}
            </ol>
          </Section>

          {/* ── Features (vertical list) ──────────────────────────── */}
          <Section
            id="hermes-features"
            eyebrow={t("featuresEyebrow")}
            eyebrowColor="text-muted-foreground"
            heading={t("featuresHeading")}
            marginTop="mt-12 md:mt-16"
          >
            <ul className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border/60 bg-border/60 md:grid-cols-2">
              {FEATURES.map(({ titleKey, bodyKey, Icon, accent }) => (
                <li
                  key={titleKey}
                  className="bg-card/80 hover:bg-card flex items-start gap-4 px-6 py-5 transition-colors md:gap-5 md:px-8 md:py-6"
                >
                  <div
                    aria-hidden
                    className={cn(
                      "flex size-10 shrink-0 items-center justify-center rounded-xl",
                      accent,
                    )}
                  >
                    <Icon className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-foreground text-base font-semibold tracking-tight md:text-lg">
                      {t(titleKey)}
                    </h3>
                    <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                      {t(bodyKey)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </Section>

          {/* ── Things to try (click-through) ─────────────────────── */}
          <Section
            id="hermes-examples"
            eyebrow={t("examplesEyebrow")}
            eyebrowColor="text-muted-foreground"
            heading={t("examplesHeading")}
            description={t("examplesPickHint")}
            marginTop="mt-12 md:mt-16"
          >
            <ExamplesCarousel />
          </Section>

          {/* ── Bottom CTA ────────────────────────────────────────── */}
          <div className="mt-12 flex flex-col items-center gap-4 md:mt-16">
            <Button
              size="lg"
              variant="primary"
              className="h-12 gap-2 px-8 text-base shadow-sm"
              onClick={onActivate}
            >
              <span>{t("primaryCta")}</span>
              <ArrowRight className="size-4" aria-hidden />
            </Button>
            <p className="text-muted-foreground/80 max-w-xl text-center text-xs leading-relaxed">
              {t("footnote")}
            </p>
          </div>

          {/* ── Honest disclaimer about agent risks ─────────────────── */}
          <div id="hermes-safeguards" className="mt-12 md:mt-16">
            <div className="border-border/60 bg-card/80 rounded-2xl border p-6 md:p-8">
              <div className="flex items-center gap-3">
                <div
                  aria-hidden
                  className="bg-amber-500/10 text-amber-700 dark:text-amber-400 flex size-10 shrink-0 items-center justify-center rounded-xl"
                >
                  <ShieldAlert className="size-5" />
                </div>
                <span className="text-foreground text-lg font-light tracking-tight md:text-xl">
                  {t("disclaimerHeading")}
                </span>
              </div>
              <ul className="mt-6 grid gap-3.5 md:grid-cols-2 md:gap-x-10 md:gap-y-4">
                {(
                  [
                    "disclaimer1",
                    "disclaimer2",
                    "disclaimer3",
                    "disclaimer4",
                  ] as const
                ).map((key) => (
                  <li key={key} className="flex items-start gap-3">
                    <span
                      aria-hidden
                      className="bg-amber-500/60 mt-2 size-1.5 shrink-0 rounded-full"
                    />
                    <span className="text-foreground/90 text-sm leading-relaxed">
                      {t(key)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </FlowBackground>
    </EmptyStateSeedContext.Provider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Section({
  id,
  eyebrow,
  eyebrowColor,
  heading,
  description,
  marginTop = "mt-28 md:mt-36",
  children,
}: {
  id?: string;
  eyebrow: string;
  eyebrowColor: string;
  heading: string;
  description?: string;
  marginTop?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={cn("scroll-mt-20", marginTop)}>
      <div className="mb-6 flex flex-col md:mb-8">
        <div
          className={cn(
            "text-xs font-semibold uppercase tracking-wider",
            eyebrowColor,
          )}
        >
          {eyebrow}
        </div>
        <h2 className="text-foreground mt-2 max-w-2xl text-2xl font-light tracking-tight md:text-3xl">
          {heading}
        </h2>
        {description ? (
          <p className="text-muted-foreground mt-3 max-w-2xl text-sm leading-relaxed md:text-base">
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function ActivationBrief() {
  const t = useTranslations("App.Hermes.EmptyState");
  const tOnboarding = useTranslations("App.Hermes.Onboarding");
  const rows: Array<{
    Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
    title: string;
    body: string;
  }> = [
    {
      Icon: Lock,
      title: t("feature4Title"),
      body: t("feature4Body"),
    },
    {
      Icon: Plug,
      title: t("feature6Title"),
      body: t("feature6Body"),
    },
    {
      Icon: Gauge,
      title: tOnboarding("autonomyMediumLabel"),
      body: tOnboarding("autonomyMediumBody"),
    },
    {
      Icon: Sparkles,
      title: t("feature2Title"),
      body: t("feature2Body"),
    },
  ];

  return (
    <aside className="border-border/60 bg-card/80 rounded-2xl border p-5">
      <div>
        <p className="text-primary text-xs font-semibold uppercase tracking-wider">
          {t("featuresEyebrow")}
        </p>
        <h2 className="text-foreground mt-2 text-xl font-light tracking-tight">
          {t("sokosumiTitle")}
        </h2>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          {t("sokosumiBody")}
        </p>
      </div>

      <dl className="border-border/60 mt-5 divide-y border-t">
        {rows.map(({ Icon, title, body }) => (
          <div key={title} className="flex gap-3 py-4">
            <div
              aria-hidden
              className="bg-muted text-muted-foreground mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg"
            >
              <Icon className="size-4" />
            </div>
            <div>
              <dt className="text-foreground text-sm font-medium">{title}</dt>
              <dd className="text-muted-foreground mt-1 text-xs leading-relaxed">
                {body}
              </dd>
            </div>
          </div>
        ))}
      </dl>
    </aside>
  );
}

function JourneyRow({
  step,
  index,
}: {
  step: (typeof JOURNEY)[number];
  index: number;
}) {
  const t = useTranslations("App.Hermes.EmptyState");

  return (
    <li
      id={`hermes-step-${index + 1}`}
      className="border-border/60 bg-card/80 flex min-h-full scroll-mt-24 flex-col overflow-hidden rounded-2xl border"
    >
      <div className="flex flex-1 flex-col p-6">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className={cn(
              "bg-card text-foreground inline-flex size-10 items-center justify-center rounded-full border font-mono text-sm font-semibold tabular-nums",
              step.accentRing,
            )}
          >
            {String(index + 1).padStart(2, "0")}
          </span>
          <span
            className={cn(
              "text-xs font-semibold uppercase tracking-wider",
              step.accentText,
            )}
          >
            {t(step.tagKey)}
          </span>
        </div>
        <h3 className="text-foreground mt-5 text-xl font-light tracking-tight md:text-2xl">
          {t(step.titleKey)}
        </h3>
        <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
          {t(step.bodyKey)}
        </p>
      </div>

      <div className="border-border/60 bg-background/60 border-t p-4">
        <step.Visual />
      </div>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-step visualizations. Each is a self-contained composition — no shared
// helper. They lean on borders + type and use color only for status
// (success check, active dot, warning) so they read as "instrument panel"
// rather than "marketing illustration".

function ActivationVisual() {
  const seed = useContext(EmptyStateSeedContext);
  const t = useTranslations("App.Hermes.EmptyState.visuals");
  const tCommon = useTranslations("App.Hermes.Common");

  return (
    <div className="relative flex h-56 items-center justify-center">
      <div
        aria-hidden
        className="bg-primary/10 absolute size-40 rounded-full blur-3xl"
      />
      <div className="border-border/60 bg-background/80 relative flex flex-col items-center gap-4 rounded-2xl border px-8 py-6">
        <AuroraOrb
          seed={seed}
          size={96}
          expression="happy"
          className="size-16"
        />
        <div className="text-foreground text-sm font-semibold tracking-tight">
          {tCommon("hermesAvatarAlt")}
        </div>
        <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
          <span
            aria-hidden
            className="size-1.5 animate-pulse rounded-full bg-emerald-500"
          />
          <span>{t("activated")}</span>
        </div>
      </div>
    </div>
  );
}

function ConnectionVisual() {
  const seed = useContext(EmptyStateSeedContext);
  const satellites: Array<{ src: string; pos: string }> = [
    { src: "/icons/gmail.svg", pos: "top-2 left-8" },
    { src: "/icons/google-calendar.svg", pos: "top-2 right-8" },
    { src: "/icons/slack.svg", pos: "bottom-2 left-8" },
    { src: "/icons/linear.svg", pos: "bottom-2 right-8" },
    {
      src: "/icons/notion.svg",
      pos: "top-1/2 left-2 -translate-y-1/2",
    },
    {
      src: "/icons/github.svg",
      pos: "top-1/2 right-2 -translate-y-1/2",
    },
  ];
  return (
    <div className="relative mx-auto h-56 w-full max-w-md">
      {/* Faint dashed connectors */}
      <svg
        aria-hidden
        viewBox="0 0 400 220"
        preserveAspectRatio="none"
        className="text-border absolute inset-0 size-full"
      >
        <g
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="3 4"
          fill="none"
        >
          <line x1="200" y1="110" x2="80" y2="30" />
          <line x1="200" y1="110" x2="320" y2="30" />
          <line x1="200" y1="110" x2="80" y2="190" />
          <line x1="200" y1="110" x2="320" y2="190" />
          <line x1="200" y1="110" x2="40" y2="110" />
          <line x1="200" y1="110" x2="360" y2="110" />
        </g>
      </svg>
      {/* Center: Hermes */}
      <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
        <AuroraOrb
          seed={seed}
          size={96}
          expression="idle"
          className="size-16"
        />
      </div>
      {/* Satellites */}
      {satellites.map(({ src, pos }) => (
        <div
          key={src}
          className={cn(
            "border-border/60 bg-background absolute flex size-10 items-center justify-center rounded-xl border",
            pos,
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" className="size-5" />
        </div>
      ))}
    </div>
  );
}

function ActVisual() {
  const t = useTranslations("App.Hermes.EmptyState.visuals");
  const actSteps = orderedMessageList(
    t.raw("actSteps") as Record<string, string>,
  );

  return (
    <div className="mx-auto flex max-w-md flex-col gap-2">
      {/* User message */}
      <div className="bg-primary text-primary-foreground self-end rounded-2xl rounded-tr-md px-3.5 py-2 text-xs leading-snug shadow-sm">
        {t("actUserMessage")}
      </div>
      {/* Hermes acting */}
      <div className="border-border/60 bg-background/80 self-start rounded-2xl rounded-tl-md border px-3.5 py-2.5">
        <div className="text-tertiary-foreground inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider">
          <Wand2 className="size-3" aria-hidden />
          <span>{t("actWorking")}</span>
        </div>
        <ul className="mt-2 flex flex-col gap-1.5">
          {[
            { src: "/icons/google-calendar.svg", label: actSteps[0] },
            { src: "/icons/gmail.svg", label: actSteps[1] },
            {
              src: null,
              label: actSteps[2],
              done: false,
            },
          ].map((row, i) => (
            <li
              key={i}
              className="border-border/40 bg-card flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs"
            >
              {row.src ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={row.src} alt="" className="size-3.5 shrink-0" />
              ) : (
                <Sparkles
                  className="text-primary size-3.5 shrink-0"
                  aria-hidden
                />
              )}
              <span className="text-foreground flex-1">{row.label}</span>
              {row.done === false ? (
                <Loader2
                  className="text-muted-foreground size-3 animate-spin"
                  aria-hidden
                />
              ) : (
                <Check className="size-3 text-emerald-500" aria-hidden />
              )}
            </li>
          ))}
        </ul>
        <div className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
          <Check className="size-3" aria-hidden />
          <span>{t("actHeld")}</span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Things to try — click-through carousel.
//
// Pills along the top let the user pick a prompt category; the canvas below
// renders the prompt as a user message + a mock Hermes reply so the visitor
// sees what the agent would actually do, not just a quoted string. Mock
// replies live in en.json and use a tiny markdown subset (**bold** + bullet
// lines starting with `• ` or `1.`).

function ExamplesCarousel() {
  const seed = useContext(EmptyStateSeedContext);
  const t = useTranslations("App.Hermes.EmptyState");
  const tCommon = useTranslations("App.Hermes.Common");
  const [activeKey, setActiveKey] = useState<ExampleKey>(EXAMPLES[0]!.key);
  const active = EXAMPLES.find((e) => e.key === activeKey) ?? EXAMPLES[0]!;

  return (
    <div className="flex flex-col gap-5">
      {/* Pills — horizontally scrollable on narrow viewports */}
      <div className="-mx-2 overflow-x-auto px-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex min-w-max items-center gap-2">
          {EXAMPLES.map(({ key, categoryKey, Icon }) => {
            const isActive = key === activeKey;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActiveKey(key)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  isActive
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-card text-foreground hover:border-foreground/30 hover:bg-muted/30",
                )}
                aria-pressed={isActive}
              >
                <Icon className="size-3.5" aria-hidden />
                <span>{t(`exampleCategories.${categoryKey}`)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Canvas */}
      <div
        key={active.key}
        className="border-border/60 bg-card/60 animate-in fade-in-0 slide-in-from-bottom-1 flex flex-col gap-4 rounded-2xl border p-6 backdrop-blur-sm duration-200 md:p-8"
      >
        {/* User prompt */}
        <div className="flex justify-end">
          <div className="bg-primary text-primary-foreground max-w-[88%] rounded-2xl rounded-tr-md px-4 py-2.5 text-sm font-medium leading-snug md:text-base">
            {t(active.key)}
          </div>
        </div>

        {/* Hermes reply */}
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="bg-card border-border ring-background relative mt-0.5 size-8 shrink-0 overflow-hidden rounded-full border ring-2"
          >
            <AuroraOrb
              seed={seed}
              size={64}
              expression="happy"
              className="size-full"
            />
          </span>
          <div className="border-border bg-background min-w-0 flex-1 rounded-2xl rounded-tl-md border px-4 py-3">
            <div className="text-tertiary-foreground mb-2 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider">
              <Sparkles className="size-3" aria-hidden />
              <span>{tCommon("hermesAvatarAlt")}</span>
            </div>
            <MockMarkdown text={t(active.replyKey)} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Tiny renderer for the mock replies. Splits on blank lines into blocks,
 * detects bullet (`• `) and numbered (`1. `) lists, and replaces `**…**`
 * inline with `<strong>`. Just enough markdown to make the mocks readable
 * without pulling in a real parser for a marketing string.
 */
function MockMarkdown({ text }: { text: string }) {
  const blocks = text.split(/\n\s*\n/);
  return (
    <div className="text-foreground flex flex-col gap-3 text-sm leading-relaxed">
      {blocks.map((block, blockIdx) => {
        const lines = block.split("\n");
        const isBulletList = lines.every((l) => l.trim().startsWith("• "));
        const isNumberedList = lines.every((l) => /^\s*\d+\.\s/.test(l));

        if (isBulletList) {
          return (
            <ul key={blockIdx} className="flex flex-col gap-1.5 pl-1">
              {lines.map((line, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span aria-hidden className="text-muted-foreground/60 mt-0.5">
                    •
                  </span>
                  <span className="flex-1">
                    <InlineBold text={line.replace(/^•\s+/, "")} />
                  </span>
                </li>
              ))}
            </ul>
          );
        }

        if (isNumberedList) {
          return (
            <ol key={blockIdx} className="flex flex-col gap-1.5 pl-1">
              {lines.map((line, i) => {
                const match = line.match(/^\s*(\d+)\.\s+(.*)$/);
                if (!match) return null;
                return (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-muted-foreground/70 font-mono tabular-nums">
                      {match[1]}.
                    </span>
                    <span className="flex-1">
                      <InlineBold text={match[2]!} />
                    </span>
                  </li>
                );
              })}
            </ol>
          );
        }

        // Treat lines starting with `> ` as a quoted block (the draft reply).
        if (lines.every((l) => l.trim().startsWith(">"))) {
          return (
            <blockquote
              key={blockIdx}
              className="border-border bg-muted/30 text-foreground/90 rounded-md border-l-2 px-3 py-2 italic"
            >
              {lines.map((l, i) => (
                <div key={i}>
                  <InlineBold text={l.replace(/^>\s?/, "")} />
                </div>
              ))}
            </blockquote>
          );
        }

        return (
          <p key={blockIdx} className="text-foreground">
            {lines.map((line, i) => (
              <span key={i}>
                <InlineBold text={line} />
                {i < lines.length - 1 ? <br /> : null}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function InlineBold({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        const bold = part.startsWith("**") && part.endsWith("**");
        if (bold) {
          return (
            <strong key={i} className="text-foreground font-semibold">
              {part.slice(2, -2)}
            </strong>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}
