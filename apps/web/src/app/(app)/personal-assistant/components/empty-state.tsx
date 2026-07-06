"use client";

import {
  ArrowRight,
  Check,
  ListTodo,
  Loader2,
  Mail,
  Repeat,
  ShieldAlert,
  Sparkles,
  Wand2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { type ComponentType, createContext, useContext, useState } from "react";

import FlowBackground from "@/app/personal-assistant/components/flow-background";
import { AuroraOrb, PlaceholderOrb } from "@/components/aurora-orb";
import { Button } from "@/components/ui/button";
import { orbSeedFor } from "@/lib/aurora-orb";
import { orderedMessageList } from "@/lib/intl/ordered-message-list";
import { cn } from "@/lib/utils";

/**
 * Fixed orb seed for the landing-page demo visuals. The hero shows the
 * porcelain placeholder ("not yours yet"); the mocks show an example
 * activated assistant in jewel sky — friendly, confident, and distinct from
 * the page's purple accent. The user picks their own colour in setup.
 */
const DEMO_ORB_SEED = orbSeedFor("jewel-sky", "hermes-demo");

/** The demo orb seed, shared with the journey-visual sub-components
 * (referenced via a data array, so prop-threading would be awkward). */
const EmptyStateSeedContext = createContext<string>(DEMO_ORB_SEED);

interface EmptyStateProps {
  onActivate: () => void;
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
 * visualizations lean on borders + type — color is reserved for status
 * (active dot, success check) so the rhythm stays calm; the connecting
 * timeline spine carries the single brand-purple accent.
 */
const JOURNEY: Array<{
  tagKey: string;
  titleKey: string;
  bodyKey: string;
  Visual: ComponentType;
}> = [
  {
    tagKey: "journeyStep1Tag",
    titleKey: "journeyStep1Title",
    bodyKey: "journeyStep1Body",
    Visual: ActivationVisual,
  },
  {
    tagKey: "journeyStep3Tag",
    titleKey: "journeyStep3Title",
    bodyKey: "journeyStep3Body",
    Visual: ConnectionVisual,
  },
  {
    tagKey: "journeyStep5Tag",
    titleKey: "journeyStep5Title",
    bodyKey: "journeyStep5Body",
    Visual: ActVisual,
  },
];

const FEATURES: Array<{
  titleKey: string;
  bodyKey: string;
}> = [
  { titleKey: "feature2Title", bodyKey: "feature2Body" },
  { titleKey: "feature4Title", bodyKey: "feature4Body" },
  { titleKey: "feature5Title", bodyKey: "feature5Body" },
  { titleKey: "feature6Title", bodyKey: "feature6Body" },
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

/** A subset of connectors surfaced as an icon-only proof rail in the hero.
 * The full labelled grid lives in the Integrations section below. */
const HERO_RAIL = SERVICE_LOGOS.slice(0, 9);

export default function EmptyState({ onActivate }: EmptyStateProps) {
  const t = useTranslations("App.Hermes.EmptyState");
  const tCommon = useTranslations("App.Hermes.Common");
  const tServices = useTranslations("App.Hermes.EmptyState.serviceLabels");

  return (
    <EmptyStateSeedContext.Provider value={DEMO_ORB_SEED}>
      <FlowBackground>
        <div className="relative isolate w-full overflow-hidden">
          {/* ── Atmosphere — one soft wisteria bloom behind the hero,
               dying out well before the CTA row so the button owns the
               accent. Kept deliberately quiet: the app is white/black/
               gray first, purple only where it communicates. ── */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] [mask-image:linear-gradient(to_bottom,black,transparent_80%)]"
          >
            <div className="bg-primary/10 dark:bg-primary/15 absolute left-1/2 top-[-140px] size-[440px] -translate-x-1/2 rounded-full blur-[100px]" />
          </div>

          <div className="mx-auto w-full max-w-6xl px-2 pb-12">
            {/* ── Hero — open (no card) so it reads as a moment, not a box.
                 One-time staggered entrance; motion-safe only, transform +
                 opacity, ≤500ms, [animation-fill-mode:both] so nothing
                 flashes before its delay. ── */}
            <section className="flex flex-col items-center pb-12 pt-8 text-center md:pb-16 md:pt-14">
              {/* Orb staging: a wisteria bloom that hugs the orb plus two
                  concentric hairline rings — one breathing, one fading out —
                  so the page's brand moment reads staged, not adrift. */}
              <div className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 relative flex items-center justify-center duration-500 [animation-fill-mode:both]">
                <div
                  aria-hidden
                  className="bg-primary/10 absolute size-80 rounded-full blur-3xl"
                />
                <div
                  aria-hidden
                  className="bg-primary/15 dark:bg-primary/25 absolute size-52 rounded-full blur-2xl"
                />
                <div
                  aria-hidden
                  className="border-border/60 absolute size-72 rounded-full border [mask-image:linear-gradient(to_bottom,black,transparent)]"
                />
                <div
                  aria-hidden
                  className="border-primary/20 motion-safe:animate-pulse absolute size-52 rounded-full border"
                />
                <PlaceholderOrb
                  size={280}
                  expression="happy"
                  className="relative size-32 md:size-40"
                  alt={tCommon("hermesAvatarAlt")}
                />
              </div>

              <h1 className="text-foreground motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 mt-8 max-w-3xl text-balance text-4xl font-light tracking-tight duration-500 [animation-delay:100ms] [animation-fill-mode:both] md:text-5xl">
                {t("title")}
              </h1>
              <p className="text-muted-foreground motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 mt-5 max-w-xl text-pretty text-base leading-relaxed duration-500 [animation-delay:180ms] [animation-fill-mode:both] md:text-lg">
                {t("subtitle")}
              </p>

              <div className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 mt-8 duration-500 [animation-delay:260ms] [animation-fill-mode:both]">
                <Button
                  size="lg"
                  variant="primary"
                  className="group shadow-primary/20 hover:shadow-primary/30 h-12 gap-2 px-6 text-base shadow-md transition-all hover:shadow-lg active:scale-[0.98]"
                  onClick={onActivate}
                >
                  <span>{t("primaryCta")}</span>
                  <ArrowRight
                    className="size-4 transition-transform duration-200 group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </Button>
                <p className="text-muted-foreground/70 mx-auto mt-3 max-w-md text-pretty text-xs leading-relaxed">
                  {t("description")}
                </p>
              </div>

              {/* Proof rail — icon-only teaser; the labelled grid below owns
                  the heading, so nine recognizable logos need no caption. */}
              <ul className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 mt-10 flex flex-wrap items-center justify-center gap-2 duration-500 [animation-delay:340ms] [animation-fill-mode:both]">
                {HERO_RAIL.map(({ src, labelKey }) => (
                  <li
                    key={labelKey}
                    title={tServices(labelKey)}
                    className="border-border/50 bg-background/80 hover:border-border flex size-10 items-center justify-center rounded-lg border transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt="" className="size-5" />
                  </li>
                ))}
                <li className="border-border/50 text-muted-foreground flex h-10 items-center rounded-lg border border-dashed px-3 text-xs">
                  {t("servicesMoreLabel")}
                </li>
              </ul>
            </section>

            {/* ── Features ──────────────────────────────────────────── */}
            <Section
              eyebrow={t("featuresEyebrow")}
              heading={t("featuresHeading")}
              marginTop="mt-6 md:mt-8"
            >
              {/* One segmented band — hairline gaps instead of icon tiles,
                  echoing the brand's segmented-lines principle. Quiet type
                  does the work: title leads, muted body supports. */}
              <ul className="border-border/50 bg-border/50 grid gap-px overflow-hidden rounded-xl border sm:grid-cols-2 lg:grid-cols-4">
                {FEATURES.map(({ titleKey, bodyKey }) => (
                  <li key={titleKey} className="bg-background p-5">
                    <h3 className="text-foreground text-sm font-medium">
                      {t(titleKey)}
                    </h3>
                    <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
                      {t(bodyKey)}
                    </p>
                  </li>
                ))}
              </ul>
            </Section>

            {/* ── Journey — connected timeline ──────────────────────── */}
            <Section
              eyebrow={t("journeyEyebrow")}
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

            {/* ── Things to try (click-through) ─────────────────────── */}
            <Section
              eyebrow={t("examplesEyebrow")}
              heading={t("examplesHeading")}
              description={t("examplesPickHint")}
              marginTop="mt-12 md:mt-16"
            >
              <ExamplesCarousel onActivate={onActivate} />
            </Section>

            {/* ── Integrations — full labelled grid ─────────────────── */}
            <Section
              eyebrow={t("integrationsEyebrow")}
              heading={t("servicesHeading")}
              description={t("servicesHelp")}
              marginTop="mt-12 md:mt-16"
            >
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {SERVICE_LOGOS.map(({ src, labelKey }) => (
                  <li
                    key={labelKey}
                    className="bg-muted/40 border-border/50 hover:bg-muted/60 flex items-center gap-2.5 rounded-lg border px-3 py-2.5 transition-colors"
                    title={tServices(labelKey)}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt="" className="size-4 shrink-0" />
                    <span className="text-foreground truncate text-sm">
                      {tServices(labelKey)}
                    </span>
                  </li>
                ))}
                {/* Dashed cell absorbs the grid remainder (14 logos + span-2
                    = 16 cells) so the 4-col lattice closes flush. */}
                <li className="border-border/50 text-muted-foreground flex items-center justify-center rounded-lg border border-dashed px-3 py-2.5 text-sm lg:col-span-2">
                  {t("servicesMoreLabel")}
                </li>
              </ul>
            </Section>

            {/* ── Honest disclaimer about agent risks — placed before the
                 final ask so "before you start" literally precedes the
                 start button, and the page ends on activation. ── */}
            <div className="mt-12 md:mt-16">
              <div className="border-border/50 bg-muted/30 rounded-xl border p-5 md:p-6">
                <div className="flex items-center gap-3">
                  <div
                    aria-hidden
                    className="bg-semantic-warning/10 text-semantic-warning flex size-9 shrink-0 items-center justify-center rounded-lg"
                  >
                    <ShieldAlert className="size-4" />
                  </div>
                  <span className="text-foreground text-base font-medium">
                    {t("disclaimerHeading")}
                  </span>
                </div>
                <ul className="mt-5 grid gap-3 md:grid-cols-2 md:gap-x-8">
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
                        className="bg-muted-foreground/40 mt-2 size-1.5 shrink-0 rounded-full"
                      />
                      <span className="text-foreground/90 text-sm leading-relaxed">
                        {t(key)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* ── Closing CTA — the escalating close: not "meet it" again,
                 but "this is your front door to Sokosumi". Orb returns with
                 the hero's bloom + breathing ring, bookending the page. ── */}
            <section className="relative mt-8 md:mt-10">
              <div className="border-border/50 bg-muted/30 relative flex flex-col items-center overflow-hidden rounded-xl border px-6 py-12 text-center md:py-16">
                <div className="relative flex items-center justify-center">
                  <div
                    aria-hidden
                    className="bg-primary/10 dark:bg-primary/20 absolute size-44 rounded-full blur-2xl"
                  />
                  <div
                    aria-hidden
                    className="border-primary/20 motion-safe:animate-pulse absolute size-28 rounded-full border"
                  />
                  <PlaceholderOrb
                    size={200}
                    expression="happy"
                    className="relative size-20"
                    alt={tCommon("hermesAvatarAlt")}
                  />
                </div>
                <h2 className="text-foreground relative mt-6 max-w-2xl text-balance text-2xl font-light tracking-tight md:text-3xl">
                  {t("sokosumiTitle")}
                </h2>
                <p className="text-muted-foreground relative mt-3 max-w-xl text-pretty text-sm leading-relaxed">
                  {t("sokosumiBody")}
                </p>
                <div className="relative mt-7">
                  <Button
                    size="lg"
                    variant="primary"
                    className="group shadow-primary/20 hover:shadow-primary/30 h-12 gap-2 px-6 text-base shadow-md transition-all hover:shadow-lg active:scale-[0.98]"
                    onClick={onActivate}
                  >
                    <span>{t("primaryCta")}</span>
                    <ArrowRight
                      className="size-4 transition-transform duration-200 group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </Button>
                </div>
                <p className="text-muted-foreground/80 relative mt-5 max-w-xl text-pretty text-xs leading-relaxed">
                  {t("footnote")}
                </p>
              </div>
            </section>
          </div>
        </div>
      </FlowBackground>
    </EmptyStateSeedContext.Provider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Section({
  eyebrow,
  heading,
  description,
  marginTop = "mt-28 md:mt-36",
  children,
}: {
  eyebrow: string;
  heading: string;
  description?: string;
  marginTop?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={marginTop}>
      <div className="mb-6 flex flex-col">
        <div className="text-muted-foreground text-xs font-medium uppercase tracking-widest">
          {eyebrow}
        </div>
        <h2 className="text-foreground mt-2 max-w-2xl text-balance text-xl font-light tracking-tight md:text-2xl">
          {heading}
        </h2>
        {description ? (
          <p className="text-muted-foreground mt-2 max-w-2xl text-pretty text-sm leading-relaxed">
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function JourneyRow({
  step,
  index,
}: {
  step: (typeof JOURNEY)[number];
  index: number;
}) {
  const t = useTranslations("App.Hermes.EmptyState");

  const isLast = index === JOURNEY.length - 1;

  return (
    // The purple thread lives on the card itself as an ::after connector
    // that bridges the 16px gutter to the next card (md+), aligned to the
    // node centers (pt-6 + half of size-7 = 38px). Purple appears only
    // between the steps — never inside the cards.
    <li
      className={cn(
        "relative flex min-h-full",
        !isLast &&
          "md:after:bg-primary/40 md:after:absolute md:after:-right-4 md:after:top-[38px] md:after:h-px md:after:w-4 md:after:content-['']",
      )}
    >
      <div className="bg-muted/30 border-border/50 flex min-h-full w-full flex-col overflow-hidden rounded-xl border">
        <div className="flex flex-col p-5 pt-6">
          {/* Numbered node — neutral, so the step title leads; the spine
            between the cards is the section's only accent. */}
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="border-border bg-background text-foreground relative inline-flex size-7 items-center justify-center rounded-full border text-xs font-semibold tabular-nums"
            >
              {index + 1}
            </span>
            <span className="text-muted-foreground text-xs font-medium uppercase tracking-wider tabular-nums">
              {t(step.tagKey)}
            </span>
          </div>
          <h3 className="text-foreground mt-4 text-sm font-semibold">
            {t(step.titleKey)}
          </h3>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
            {t(step.bodyKey)}
          </p>
        </div>

        {/* The visual band takes the flexible space and centers its content,
          so unequal copy lengths pool here as intentional framing instead
          of as a hole between text and visual. */}
        <div className="border-border/50 bg-background/40 flex flex-1 items-center justify-center border-t p-3">
          <step.Visual />
        </div>
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
    <div className="relative flex h-36 items-center justify-center">
      <div
        aria-hidden
        className="bg-foreground/5 absolute size-28 rounded-full blur-2xl"
      />
      <div className="border-border/60 bg-background/80 relative flex flex-col items-center gap-3 rounded-xl border px-5 py-4">
        <AuroraOrb
          seed={seed}
          size={96}
          expression="happy"
          className="size-12"
        />
        <div className="text-foreground text-sm font-medium tracking-tight">
          {tCommon("hermesAvatarAlt")}
        </div>
        <div className="border-semantic-success/30 bg-semantic-success/10 text-semantic-success inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium">
          <span
            aria-hidden
            className="bg-semantic-success size-1.5 animate-pulse rounded-full"
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
    <div className="relative mx-auto h-36 w-full max-w-xs">
      {/* Faint dashed connectors */}
      <svg
        aria-hidden
        viewBox="0 0 320 160"
        preserveAspectRatio="none"
        className="text-border absolute inset-0 size-full"
      >
        <g
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="3 4"
          fill="none"
        >
          <line x1="160" y1="80" x2="64" y2="24" />
          <line x1="160" y1="80" x2="256" y2="24" />
          <line x1="160" y1="80" x2="64" y2="136" />
          <line x1="160" y1="80" x2="256" y2="136" />
          <line x1="160" y1="80" x2="32" y2="80" />
          <line x1="160" y1="80" x2="288" y2="80" />
        </g>
      </svg>
      {/* Center: Hermes */}
      <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
        <AuroraOrb
          seed={seed}
          size={96}
          expression="idle"
          className="size-12"
        />
      </div>
      {/* Satellites */}
      {satellites.map(({ src, pos }) => (
        <div
          key={src}
          className={cn(
            "border-border/60 bg-background absolute flex size-8 items-center justify-center rounded-lg border",
            pos,
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" className="size-4" />
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
    <div className="mx-auto flex max-w-sm flex-col gap-2">
      {/* User message */}
      <div className="bg-primary text-primary-foreground self-end rounded-xl rounded-tr-md px-3.5 py-2 text-xs leading-snug shadow-sm">
        {t("actUserMessage")}
      </div>
      {/* Hermes acting */}
      <div className="border-border/60 bg-background/80 self-start rounded-xl rounded-tl-md border px-3.5 py-2.5">
        <div className="text-tertiary-foreground inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider">
          <Wand2 className="size-3" aria-hidden />
          <span>{t("actWorking")}</span>
        </div>
        <ul className="mt-2 flex flex-col gap-1">
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
              className="border-border/40 bg-card flex items-center gap-2 rounded-md border px-2 py-1 text-xs"
            >
              {row.src ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={row.src} alt="" className="size-3.5 shrink-0" />
              ) : (
                <Sparkles
                  className="text-muted-foreground size-3.5 shrink-0"
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
                // Per-row checks stay neutral; the held-for-review line
                // below is the visual's single green signal.
                <Check className="text-muted-foreground size-3" aria-hidden />
              )}
            </li>
          ))}
        </ul>
        <div className="text-semantic-success mt-2 inline-flex items-center gap-1.5 text-xs font-medium">
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

function ExamplesCarousel({ onActivate }: { onActivate: () => void }) {
  const seed = useContext(EmptyStateSeedContext);
  const t = useTranslations("App.Hermes.EmptyState");
  const tCommon = useTranslations("App.Hermes.Common");
  const [activeKey, setActiveKey] = useState<ExampleKey>(EXAMPLES[0]!.key);
  const active = EXAMPLES.find((e) => e.key === activeKey) ?? EXAMPLES[0]!;

  return (
    <div className="flex flex-col gap-4">
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
                  "inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition-all duration-200 active:scale-[0.98]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2",
                  isActive
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : "border-border bg-card text-foreground hover:border-foreground/25 hover:bg-muted/40",
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
        className="bg-muted/30 border-border/50 animate-in fade-in-0 slide-in-from-bottom-1 flex flex-col gap-4 rounded-xl border p-5 duration-200 md:p-6"
      >
        {/* User prompt — capped at a chat-plausible measure so it reads as
            a message, not a purple banner out-shouting the CTA. */}
        <div className="flex justify-end">
          <div className="bg-primary text-primary-foreground max-w-[75%] rounded-xl rounded-tr-md px-4 py-2.5 text-sm font-medium leading-snug md:max-w-xl">
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
          <div className="border-border/60 bg-background/60 min-w-0 flex-1 rounded-xl rounded-tl-md border px-4 py-3">
            <div className="text-tertiary-foreground mb-2 inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider">
              <Sparkles className="size-3" aria-hidden />
              <span>{tCommon("hermesAvatarAlt")}</span>
            </div>
            <MockMarkdown text={t(active.replyKey)} />
          </div>
        </div>
      </div>

      {/* Quiet mid-page action — catches users at the moment the mock
          reply convinces them; outline keeps the filled purple reserved
          for the hero and the close. */}
      <div className="mt-1 flex justify-center">
        <Button variant="outline" className="group gap-2" onClick={onActivate}>
          <span>{t("primaryCta")}</span>
          <ArrowRight
            className="size-4 transition-transform duration-200 group-hover:translate-x-0.5"
            aria-hidden
          />
        </Button>
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
                    <span className="text-muted-foreground/70 tabular-nums">
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
