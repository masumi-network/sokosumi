"use client";

import { ArrowRight, ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";

import FlowBackground from "@/app/personal-assistant/components/flow-background";
import { PlaceholderOrb } from "@/components/aurora-orb";
import { Button } from "@/components/ui/button";

import { DEMO_ORB_SEED, EmptyStateSeedContext } from "./empty-state/demo-orb";
import { ExamplesCarousel } from "./empty-state/examples-carousel";
import { FEATURES } from "./empty-state/features";
import { JOURNEY, JourneyRow } from "./empty-state/journey";
import { Section } from "./empty-state/section";
import { HERO_RAIL, SERVICE_LOGOS } from "./empty-state/service-logos";

interface EmptyStateProps {
  onActivate: () => void;
}

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
                  className="group h-12 gap-2 text-base"
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
              {/* One segmented band — hairline gaps, small bordered icon
                  tiles for a quiet illustration per feature. Color stays
                  contained to the tile (the Swiss flag keeps its native
                  red/white, same treatment as the service logos below). */}
              <ul className="border-border/50 bg-border/50 grid gap-px overflow-hidden rounded-xl border sm:grid-cols-2 lg:grid-cols-5">
                {FEATURES.map(({ titleKey, bodyKey, Icon }) => (
                  <li key={titleKey} className="bg-background p-5">
                    <div
                      aria-hidden
                      className="bg-muted/60 border-border/50 text-muted-foreground flex size-9 items-center justify-center overflow-hidden rounded-lg border"
                    >
                      <Icon className="size-4" />
                    </div>
                    <h3 className="text-foreground mt-3 text-sm font-medium">
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
                    className="group h-12 gap-2 text-base"
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
