"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { ArrowRight, CalendarDays, Repeat, Sun } from "lucide-react";
import { useTransition } from "react";

import { brandStyle, Section } from "../brand-profile";
import { goalLine } from "../strategy-reveal";
import { StepHead } from "./step-head";

type Strategy = NonNullable<CmoOverview["strategy"]>;

/** What Cuso does on his own schedule; it matches his daily, weekly and monthly runs. */
const RHYTHM = [
  {
    icon: Sun,
    when: "Every day",
    what: [
      "Finishes the next three days of pieces, images included",
      "Schedules them on your connected accounts",
      "Tells you in one line what went out and what's next",
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
}: {
  overview: CmoOverview;
  /** The step after this one, for the button. */
  next: string;
  onContinue: () => void | Promise<void>;
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
        step={4}
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
          <p className="bb-eyebrow">The number that matters</p>
          <h1 className="bb-line">
            {objective ? goalLine(objective.metric) : strategy.goals[0]}
          </h1>
          {objective ? (
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
                </li>
              ))}
            </ol>
          </Section>
        ) : null}

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
