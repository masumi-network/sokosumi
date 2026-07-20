"use client";

import { Check, Loader2, Sparkles, Wand2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ComponentType, useContext } from "react";

import { AuroraOrb } from "@/components/aurora-orb";
import { orderedMessageList } from "@/lib/intl/ordered-message-list";
import { cn } from "@/lib/utils";

import { EmptyStateSeedContext } from "./demo-orb";

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

/**
 * The end-to-end journey shown on the empty state. Each step renders a
 * compact card: number + copy above a composed visualization. The
 * visualizations lean on borders + type — color is reserved for status
 * (active dot, success check) so the rhythm stays calm; the connecting
 * timeline spine carries the single brand-purple accent.
 */
export const JOURNEY: Array<{
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

export function JourneyRow({
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
