"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { ArrowRight, CalendarDays, Repeat, Sun } from "lucide-react";
import { useTransition } from "react";

import { brandStyle, Section } from "../brand-profile";
import { MeasureFunnel } from "../strategy-core";
import { outcomeLine } from "../strategy-reveal";
import { StepHead } from "./step-head";

type Strategy = NonNullable<CmoOverview["strategy"]>;
type Measure = NonNullable<Strategy["funnel"]>[number]["measure"];

export type ConnectMeasurement = (
  provider: CmoOverview["measurement"][number]["provider"],
) => Promise<{ url: string | null; error: string | null }>;

function measureLine(measure: Measure): string {
  if (measure?.basis === "measured") {
    return `${measure.value ?? "Measured"}${measure.source ? `, from ${measure.source}` : ""}`;
  }
  if (measure?.basis === "estimated") {
    return measure.value ? `${measure.value} (my estimate)` : "My estimate";
  }
  return "Not measured yet";
}

/** What Cuso does on his own schedule; it matches his daily, weekly and monthly runs. */
const RHYTHM = [
  {
    icon: Sun,
    when: "Every day",
    what: [
      "Finishes the next three days of pieces, images and videos included",
      "Schedules them on your connected accounts",
      "Replies to new comments on your Instagram, Facebook and YouTube posts, in your voice; complaints and anything sensitive come to you",
      "Tells you in one line what went out, what he answered and what's next",
    ],
  },
  {
    icon: Repeat,
    when: "Every Monday",
    what: [
      "Checks last week's real numbers, never guesses",
      "Moves effort to what worked and drops what didn't",
      "Sends you each change; you can undo any of them",
    ],
  },
  {
    icon: CalendarDays,
    when: "Every month",
    what: [
      "Writes next month's plan from what worked",
      "Re-reads your site for news, prices and launches",
      "Keeps your goal unless you change it",
    ],
  },
];

/**
 * How the founder will know the plan works: the numbers Cuso tracks at each
 * stage, what he does every day, week and month, and when he changes course.
 */
export function ResultsStep({
  overview,
  next,
  onContinue,
  onConnectMeasurement,
}: {
  overview: CmoOverview;
  /** The step after this one, for the button. */
  next: string;
  onContinue: () => void | Promise<void>;
  onConnectMeasurement: ConnectMeasurement;
}) {
  const strategy = overview.strategy as Strategy;
  const [going, startGoing] = useTransition();
  const { objective, measurement } = strategy;
  const stages = strategy.funnel ?? [];
  const rules = measurement?.rules ?? [];
  const tracking = measurement?.tracking ?? [];

  return (
    <section className="ob-results">
      <StepHead
        step={5}
        title="Results"
        mood="point"
        say="This is how we'll know it works, and what I do every day, week and month to get there."
        action={
          <button
            type="button"
            className="ob-button ob-button-lg"
            disabled={going}
            onClick={() => startGoing(async () => onContinue())}
          >
            Continue to {next}
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        }
      />
      <div className="bb" style={brandStyle(overview)}>
        <header className="bb-hero">
          <p className="bb-eyebrow">The outcome that matters</p>
          <h1 className="bb-line">{outcomeLine(strategy)}</h1>
          {objective?.target ? (
            <p className="bb-lede">
              Target: {objective.target}
              {objective.baseline ? `. Today: ${objective.baseline}` : ""}
              {objective.baselineBasis === "assumption"
                ? " (my estimate until you tell me the real number)"
                : ""}
              .
            </p>
          ) : null}
        </header>

        {stages.length > 0 ? (
          <Section title="What I track at each step" wide>
            <ol className="ob-metrics">
              {stages.map((stage) => (
                <li key={stage.stage}>
                  <span className="note">{stage.name}</span>
                  <b>{stage.metric}</b>
                  {stage.target ? (
                    <span className="note">{stage.target}</span>
                  ) : null}
                  <span className="note">{measureLine(stage.measure)}</span>
                </li>
              ))}
            </ol>
          </Section>
        ) : null}

        <Section title="Connect your numbers">
          <p className="note">
            I read real visits, searches and orders from these. Where none of
            them reaches, I estimate and ask you for the number.
          </p>
          <MeasureFunnel
            sources={overview.measurement}
            onConnect={onConnectMeasurement}
          />
        </Section>

        <Section title="What I do" wide>
          <div className="ob-rhythm">
            {RHYTHM.map(({ icon: Icon, when, what }) => (
              <div key={when} className="ob-rhythm-card">
                <p className="ob-rhythm-when">
                  <Icon size={16} aria-hidden="true" />
                  {when}
                </p>
                <ul>
                  {what.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>

        {rules.length > 0 ? (
          <Section title="When I change course">
            <ul className="ob-rules">
              {rules.map((rule) => (
                <li key={rule.when}>
                  <span>{rule.when}</span>
                  <ArrowRight size={14} aria-hidden="true" />
                  <b>{rule.then}</b>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {tracking.length > 0 ? (
          <Section title="What we set up to measure it">
            <ul className="bb-list">
              {tracking.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Section>
        ) : null}
      </div>
    </section>
  );
}
