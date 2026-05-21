"use client";

import {
  ArrowRight,
  ArrowUpRight,
  Brain,
  Calendar,
  CalendarClock,
  Check,
  Inbox,
  ListTodo,
  Loader2,
  Lock,
  Mail,
  MessageSquare,
  Moon,
  Network,
  Plug,
  Repeat,
  ShieldAlert,
  Sparkles,
  Wand2,
} from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { type ComponentType, useState } from "react";

import FlowBackground from "@/app/hermes/components/flow-background";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  onActivate: () => void;
}

const SERVICE_LOGOS: Array<{ src: string; label: string }> = [
  { src: "/icons/gmail.svg", label: "Gmail" },
  { src: "/icons/outlook.svg", label: "Outlook" },
  { src: "/icons/google-calendar.svg", label: "Google Calendar" },
  { src: "/icons/google-sheets.svg", label: "Sheets" },
  { src: "/icons/google-docs.svg", label: "Docs" },
  { src: "/icons/slack.svg", label: "Slack" },
  { src: "/icons/teams.svg", label: "Teams" },
  { src: "/icons/notion.svg", label: "Notion" },
  { src: "/icons/linear.svg", label: "Linear" },
  { src: "/icons/jira.svg", label: "Jira" },
  { src: "/icons/github.svg", label: "GitHub" },
  { src: "/icons/hubspot.svg", label: "HubSpot" },
  { src: "/icons/x.svg", label: "X" },
  { src: "/icons/linkedin.svg", label: "LinkedIn" },
];

/**
 * The end-to-end journey shown on the empty state. Each step renders an
 * alternating two-column row: number + copy on one side, a composed
 * visualization on the other. The visualizations are intentionally
 * borders-dominant — color is reserved for status (active dot, success
 * check) so the rhythm stays calm even across six rows.
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
    tagKey: "journeyStep2Tag",
    titleKey: "journeyStep2Title",
    bodyKey: "journeyStep2Body",
    Visual: MicroVmVisual,
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
    tagKey: "journeyStep4Tag",
    titleKey: "journeyStep4Title",
    bodyKey: "journeyStep4Body",
    Visual: InboxMemoryVisual,
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
  {
    tagKey: "journeyStep6Tag",
    titleKey: "journeyStep6Title",
    bodyKey: "journeyStep6Body",
    Visual: OvernightVisual,
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
    titleKey: "feature1Title",
    bodyKey: "feature1Body",
    Icon: Brain,
    accent: "bg-primary/10 text-primary",
    hero: true,
  },
  {
    titleKey: "feature2Title",
    bodyKey: "feature2Body",
    Icon: Sparkles,
    accent: "bg-muted/40 text-muted-foreground",
  },
  {
    titleKey: "feature3Title",
    bodyKey: "feature3Body",
    Icon: MessageSquare,
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

type ExampleKey =
  | "example1"
  | "example2"
  | "example3"
  | "example4"
  | "example5"
  | "example6";

const EXAMPLES: Array<{
  key: ExampleKey;
  /** i18n key for the mocked Hermes reply (markdown-lite). */
  replyKey: `${ExampleKey}Reply`;
  category: string;
  Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}> = [
  {
    key: "example1",
    replyKey: "example1Reply",
    category: "Inbox",
    Icon: Inbox,
  },
  {
    key: "example2",
    replyKey: "example2Reply",
    category: "Reply",
    Icon: Mail,
  },
  {
    key: "example3",
    replyKey: "example3Reply",
    category: "Calendar",
    Icon: CalendarClock,
  },
  {
    key: "example4",
    replyKey: "example4Reply",
    category: "Tickets",
    Icon: ListTodo,
  },
  {
    key: "example5",
    replyKey: "example5Reply",
    category: "Schedule",
    Icon: Repeat,
  },
  {
    key: "example6",
    replyKey: "example6Reply",
    category: "Research",
    Icon: Sparkles,
  },
];

export default function EmptyState({ onActivate }: EmptyStateProps) {
  const t = useTranslations("App.Hermes.EmptyState");
  const tBeta = useTranslations("App.Hermes");

  return (
    <FlowBackground>
      <div className="mx-auto w-full max-w-5xl px-6 py-16 md:py-24">
        {/* ── Hero ──────────────────────────────────────────────── */}
        <div className="flex flex-col items-center text-center">
          <div className="relative">
            {/* Soft accent halo behind the avatar */}
            <div
              aria-hidden
              className="bg-primary/20 absolute -inset-6 rounded-full blur-2xl"
            />
            <div className="bg-card border-border/60 ring-background relative size-44 overflow-hidden rounded-full border ring-8 md:size-52">
              <Image
                src="/images/hermes/avatar.png"
                alt="Hermes"
                fill
                sizes="(min-width: 768px) 208px, 176px"
                priority
                className="object-cover"
              />
            </div>
          </div>

          <div className="mt-10 inline-flex items-center gap-2">
            <span className="text-primary text-xs font-semibold uppercase tracking-wider">
              {t("eyebrow")}
            </span>
            <span className="border-border/60 bg-card/80 text-muted-foreground rounded-full border px-2 py-0.5 text-xs font-medium uppercase tracking-wider backdrop-blur-sm">
              {tBeta("BetaTag")}
            </span>
          </div>

          <h1 className="text-foreground mt-5 max-w-3xl text-4xl font-semibold tracking-tight md:text-5xl lg:text-6xl">
            {t("title")}
          </h1>
          <p className="text-foreground/80 mt-5 max-w-xl text-lg md:text-xl">
            {t("subtitle")}
          </p>
          <p className="text-muted-foreground mt-6 max-w-xl text-sm leading-relaxed md:text-base">
            {t("description")}
          </p>

          <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
            <Button
              size="lg"
              variant="primary"
              className="h-12 gap-2 px-6 text-base shadow-lg shadow-primary/20"
              onClick={onActivate}
            >
              <span>{t("primaryCta")}</span>
              <ArrowRight className="size-4" aria-hidden />
            </Button>
            <a
              href="https://hermes-agent.nousresearch.com/"
              target="_blank"
              rel="noreferrer noopener"
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm transition-colors"
            >
              <span>{t("secondaryCta")}</span>
              <ArrowUpRight className="size-3.5" aria-hidden />
            </a>
          </div>
        </div>

        {/* ── Services strip ─────────────────────────────────────── */}
        <Section
          eyebrow="Integrations"
          eyebrowColor="text-primary"
          heading={t("servicesHeading")}
          description={t("servicesHelp")}
          marginTop="mt-28 md:mt-36"
        >
          <div className="border-border/60 from-card/80 to-card/40 relative overflow-hidden rounded-3xl border bg-gradient-to-br p-2 shadow-xl shadow-black/[0.03] backdrop-blur-md md:p-3">
            {/* Inner panel for a layered look */}
            <div className="border-border/40 bg-background/60 rounded-2xl border p-6 md:p-8">
              <ul className="flex flex-wrap items-center justify-center gap-2.5 sm:gap-3">
                {SERVICE_LOGOS.map(({ src, label }) => (
                  <li
                    key={label}
                    className="border-border/60 bg-background group flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 transition-colors hover:border-foreground/30 hover:bg-muted/30"
                    title={label}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt="" className="size-5 shrink-0" />
                    <span className="text-foreground text-sm font-medium">
                      {label}
                    </span>
                  </li>
                ))}
                <li className="border-border/40 text-muted-foreground flex items-center rounded-xl border border-dashed px-3.5 py-2.5 text-sm">
                  {t("servicesMoreLabel")}
                </li>
              </ul>
            </div>
          </div>
        </Section>

        {/* ── Journey — end-to-end step-by-step ─────────────────── */}
        <Section
          eyebrow={t("journeyEyebrow")}
          eyebrowColor="text-primary"
          heading={t("journeyHeading")}
          description={t("journeyDescription")}
          marginTop="mt-32 md:mt-40"
        >
          <ol className="flex flex-col gap-16 md:gap-24">
            {JOURNEY.map((step, idx) => (
              <JourneyRow key={step.titleKey} step={step} index={idx} />
            ))}
          </ol>
        </Section>

        {/* ── Features (vertical list) ──────────────────────────── */}
        <Section
          eyebrow={t("featuresEyebrow")}
          eyebrowColor="text-muted-foreground"
          heading={t("featuresHeading")}
          marginTop="mt-32 md:mt-40"
        >
          <ul className="border-border/60 bg-card/60 divide-border/60 flex flex-col divide-y overflow-hidden rounded-2xl border backdrop-blur-sm">
            {FEATURES.map(({ titleKey, bodyKey, Icon, accent }) => (
              <li
                key={titleKey}
                className="hover:bg-muted/20 flex items-start gap-4 px-6 py-5 transition-colors md:gap-5 md:px-8 md:py-6"
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
          eyebrow="Try this"
          eyebrowColor="text-muted-foreground"
          heading={t("examplesHeading")}
          description={t("examplesPickHint")}
          marginTop="mt-32 md:mt-40"
        >
          <ExamplesCarousel />
        </Section>

        {/* ── Sokosumi gateway — accent hero ─────────────────────── */}
        <div className="relative mt-32 md:mt-40">
          {/* Outer gradient ring */}
          <div
            aria-hidden
            className="bg-primary/20 absolute -inset-px rounded-3xl"
          />
          <div className="border-border/60 bg-card/80 relative overflow-hidden rounded-3xl border p-8 backdrop-blur-md md:p-12">
            {/* Decorative blurred circle */}
            <div
              aria-hidden
              className="bg-primary/20 absolute -right-20 -top-20 size-56 rounded-full blur-3xl"
            />
            <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:gap-10">
              <div
                aria-hidden
                className="bg-primary/15 text-primary flex size-14 shrink-0 items-center justify-center rounded-2xl"
              >
                <Network className="size-7" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-primary text-xs font-semibold uppercase tracking-wider">
                  Built for Sokosumi
                </div>
                <h2 className="text-foreground mt-2 text-2xl font-semibold tracking-tight md:text-3xl">
                  {t("sokosumiTitle")}
                </h2>
                <p className="text-muted-foreground mt-3 max-w-3xl text-base leading-relaxed">
                  {t("sokosumiBody")}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ── Bottom CTA ────────────────────────────────────────── */}
        <div className="mt-24 flex flex-col items-center gap-4 md:mt-32">
          <Button
            size="lg"
            variant="primary"
            className="h-12 gap-2 px-8 text-base shadow-lg shadow-primary/20"
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
        <div className="mt-20 md:mt-24">
          <div className="border-border/60 bg-card/50 rounded-3xl border p-8 backdrop-blur-sm md:p-10">
            <div className="flex items-center gap-3">
              <div
                aria-hidden
                className="bg-amber-500/10 text-amber-700 dark:text-amber-400 flex size-10 shrink-0 items-center justify-center rounded-xl"
              >
                <ShieldAlert className="size-5" />
              </div>
              <span className="text-foreground text-lg font-semibold tracking-tight md:text-xl">
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

        {/* ── Powered by ──────────────────────────────────────────── */}
        <div className="mt-10 flex justify-center">
          <a
            href="https://nousresearch.com"
            target="_blank"
            rel="noreferrer noopener"
            className="text-muted-foreground/60 hover:text-muted-foreground text-xs transition-colors"
          >
            {t("poweredBy")}
          </a>
        </div>
      </div>
    </FlowBackground>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Section({
  eyebrow,
  eyebrowColor,
  heading,
  description,
  marginTop = "mt-28 md:mt-36",
  children,
}: {
  eyebrow: string;
  eyebrowColor: string;
  heading: string;
  description?: string;
  marginTop?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={marginTop}>
      <div className="mb-10 flex flex-col items-center text-center md:mb-12">
        <div
          className={cn(
            "text-xs font-semibold uppercase tracking-wider",
            eyebrowColor,
          )}
        >
          {eyebrow}
        </div>
        <h2 className="text-foreground mt-3 max-w-2xl text-3xl font-semibold tracking-tight md:text-4xl">
          {heading}
        </h2>
        {description ? (
          <p className="text-muted-foreground mt-4 max-w-xl text-sm leading-relaxed md:text-base">
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Journey row — alternating two-column layout. Visual goes opposite the copy
// so the page reads like a zig-zag instead of a stack of identical cards.

function JourneyRow({
  step,
  index,
}: {
  step: (typeof JOURNEY)[number];
  index: number;
}) {
  const t = useTranslations("App.Hermes.EmptyState");
  const isReversed = index % 2 === 1;

  return (
    <li className="grid grid-cols-1 items-center gap-8 md:grid-cols-12 md:gap-12">
      {/* Copy column */}
      <div
        className={cn(
          "md:col-span-5",
          isReversed && "md:order-2 md:col-start-8",
        )}
      >
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
        <h3 className="text-foreground mt-5 text-2xl font-semibold tracking-tight md:text-3xl">
          {t(step.titleKey)}
        </h3>
        <p className="text-muted-foreground mt-3 max-w-md text-base leading-relaxed">
          {t(step.bodyKey)}
        </p>
      </div>

      {/* Visualization column */}
      <div
        className={cn(
          "md:col-span-7",
          isReversed && "md:order-1 md:col-start-1",
        )}
      >
        <div className="border-border/60 bg-card/60 relative overflow-hidden rounded-2xl border p-6 backdrop-blur-sm md:p-8">
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
  return (
    <div className="relative flex h-56 items-center justify-center">
      <div
        aria-hidden
        className="bg-primary/10 absolute size-40 rounded-full blur-3xl"
      />
      <div className="border-border/60 bg-background/80 relative flex flex-col items-center gap-4 rounded-2xl border px-8 py-6">
        <div className="bg-card border-border/60 ring-background relative size-16 overflow-hidden rounded-full border ring-4">
          <Image
            src="/images/hermes/avatar.png"
            alt=""
            fill
            sizes="64px"
            className="object-cover"
          />
        </div>
        <div className="text-foreground text-sm font-semibold tracking-tight">
          Hermes
        </div>
        <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
          <span
            aria-hidden
            className="size-1.5 animate-pulse rounded-full bg-emerald-500"
          />
          <span>Activated</span>
        </div>
        <div className="text-tertiary-foreground font-mono text-xs tabular-nums">
          bound · patrick@yellowhouse.gmbh
        </div>
      </div>
    </div>
  );
}

function MicroVmVisual() {
  return (
    <div className="relative flex h-56 items-center justify-center">
      <div className="border-border bg-background/80 relative w-full max-w-xs rounded-2xl border p-5">
        {/* Label tab — "Your microVM" */}
        <div className="bg-card border-border absolute -top-3 left-4 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5">
          <Lock className="text-muted-foreground size-3" aria-hidden />
          <span className="text-foreground text-xs font-medium tracking-wide">
            Your microVM
          </span>
        </div>

        {/* Hermes process pill */}
        <div className="border-border bg-card flex items-center gap-2 rounded-lg border px-3 py-2 font-mono text-xs">
          <span
            aria-hidden
            className="size-1.5 animate-pulse rounded-full bg-emerald-500"
          />
          <span className="text-foreground">hermes</span>
          <span className="text-muted-foreground">running</span>
        </div>

        {/* Two clean key-value rows */}
        <dl className="mt-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground text-xs">Filesystem</dt>
            <dd className="text-foreground font-mono text-xs">persistent</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground text-xs">Secrets</dt>
            <dd className="text-foreground font-mono text-xs">encrypted</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground text-xs">
              Shared with others
            </dt>
            <dd className="text-foreground font-mono text-xs">never</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

function ConnectionVisual() {
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
        <div className="bg-card border-border/60 ring-background relative size-16 overflow-hidden rounded-full border ring-4">
          <Image
            src="/images/hermes/avatar.png"
            alt=""
            fill
            sizes="64px"
            className="object-cover"
          />
        </div>
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

function InboxMemoryVisual() {
  const inbox: Array<{
    from: string;
    subject: string;
    status: "read" | "warn";
  }> = [
    { from: "Hannah", subject: "Q4 roadmap review", status: "read" },
    { from: "Alex", subject: "Cardano deal — next steps", status: "read" },
    { from: "CI bot", subject: "Build #2438 failed", status: "warn" },
  ];
  const memory = [
    "Working on the Q4 launch",
    "Hannah is the product lead",
    "Cardano deal closes Mar 15",
  ];
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="border-border/60 bg-background/60 rounded-xl border p-4">
        <div className="text-tertiary-foreground mb-3 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider">
          <Inbox className="size-3" aria-hidden />
          <span>Inbox · scanned</span>
        </div>
        <ul className="flex flex-col gap-2">
          {inbox.map((m) => (
            <li
              key={m.subject}
              className="border-border/40 flex items-center gap-2 border-b pb-2 last:border-b-0 last:pb-0"
            >
              <div className="min-w-0 flex-1">
                <div className="text-foreground truncate text-xs font-medium">
                  {m.from}
                </div>
                <div className="text-muted-foreground truncate text-xs">
                  {m.subject}
                </div>
              </div>
              {m.status === "warn" ? (
                <span
                  aria-hidden
                  className="text-amber-600 dark:text-amber-400 font-mono text-xs font-semibold uppercase"
                >
                  !
                </span>
              ) : (
                <Check className="size-3 text-emerald-500" aria-hidden />
              )}
            </li>
          ))}
        </ul>
      </div>
      <div className="border-border/60 bg-background/60 rounded-xl border p-4">
        <div className="text-tertiary-foreground mb-3 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider">
          <Brain className="size-3" aria-hidden />
          <span>Memory · written</span>
        </div>
        <ul className="flex flex-col gap-1.5">
          {memory.map((m) => (
            <li
              key={m}
              className="border-border/60 bg-card text-foreground rounded-md border px-2 py-1.5 text-xs leading-snug"
            >
              {m}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ActVisual() {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-2">
      {/* User message */}
      <div className="bg-primary text-primary-foreground self-end rounded-2xl rounded-tr-md px-3.5 py-2 text-xs leading-snug shadow-sm">
        Set a call with Hannah next Tuesday at 10am.
      </div>
      {/* Hermes acting */}
      <div className="border-border/60 bg-background/80 self-start rounded-2xl rounded-tl-md border px-3.5 py-2.5">
        <div className="text-tertiary-foreground inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider">
          <Wand2 className="size-3" aria-hidden />
          <span>Hermes is working</span>
        </div>
        <ul className="mt-2 flex flex-col gap-1.5">
          {[
            { src: "/icons/google-calendar.svg", label: "Found a free slot" },
            { src: "/icons/gmail.svg", label: "Drafted the invite" },
            {
              src: null,
              label: "Hired Research agent for context",
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
          <span>Tuesday · 10:00 AM held</span>
        </div>
      </div>
    </div>
  );
}

function OvernightVisual() {
  const schedule: Array<{
    time: string;
    label: string;
    state: "done" | "active";
  }> = [
    { time: "03:00", label: "Pull overnight email", state: "done" },
    { time: "05:30", label: "Sync Sokosumi jobs", state: "done" },
    { time: "06:45", label: "Draft your morning brief", state: "active" },
    { time: "08:00", label: "Push to chat + Telegram", state: "active" },
  ];
  return (
    <div className="border-border/60 bg-background/60 mx-auto max-w-md rounded-2xl border p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="inline-flex items-center gap-2">
          <Moon className="text-primary size-4" aria-hidden />
          <span className="text-foreground text-sm font-semibold tracking-tight">
            Tonight · 4 jobs
          </span>
        </div>
        <span className="text-tertiary-foreground font-mono text-xs tabular-nums">
          UTC · Mar 22
        </span>
      </div>
      <ol className="flex flex-col gap-2.5">
        {schedule.map((row, idx) => (
          <li key={row.time} className="flex items-center gap-3">
            <span className="text-muted-foreground w-12 shrink-0 font-mono text-xs tabular-nums">
              {row.time}
            </span>
            <span
              aria-hidden
              className={cn(
                "border-border/60 inline-flex size-5 shrink-0 items-center justify-center rounded-full border",
                row.state === "done"
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-primary/10 text-primary",
              )}
            >
              {row.state === "done" ? (
                <Check className="size-3" />
              ) : (
                <Loader2 className="size-3 animate-spin" />
              )}
            </span>
            <span className="text-foreground flex-1 text-xs leading-snug">
              {row.label}
            </span>
            {idx === schedule.length - 1 ? (
              <Calendar
                className="text-tertiary-foreground size-3 shrink-0"
                aria-hidden
              />
            ) : null}
          </li>
        ))}
      </ol>
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
  const t = useTranslations("App.Hermes.EmptyState");
  const [activeKey, setActiveKey] = useState<ExampleKey>(EXAMPLES[0]!.key);
  const active = EXAMPLES.find((e) => e.key === activeKey) ?? EXAMPLES[0]!;

  return (
    <div className="flex flex-col gap-5">
      {/* Pills — horizontally scrollable on narrow viewports */}
      <div className="-mx-2 overflow-x-auto px-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex min-w-max items-center gap-2">
          {EXAMPLES.map(({ key, category, Icon }) => {
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
                <span>{category}</span>
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
            <Image
              src="/images/hermes/avatar.png"
              alt=""
              fill
              sizes="32px"
              className="object-cover"
            />
          </span>
          <div className="border-border bg-background min-w-0 flex-1 rounded-2xl rounded-tl-md border px-4 py-3">
            <div className="text-tertiary-foreground mb-2 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider">
              <Sparkles className="size-3" aria-hidden />
              <span>Hermes</span>
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
