"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { ArrowRight, CalendarDays, Repeat, Sparkles, Sun } from "lucide-react";
import { useMemo, useState } from "react";
import { AGENT_NAME } from "../../lib/agent";
import { formatDay, planWeeks } from "../../lib/calendar";
import { Section } from "../brand-profile";
import { businessDisplayName } from "../business-mark";
import { ChannelIcon } from "../channel-icon";
import { AccountPreviews, withoutLabel } from "../showcases";
import {
  Alternatives,
  BeforeAfter,
  FunnelPlan,
  Improvements,
  MeasureFunnel,
  OfferLadder,
} from "../strategy-core";
import { Funnel } from "../strategy-funnel";
import {
  APPROACHES,
  ChannelPlan,
  Mix,
  outcomeLine,
  Pillars,
} from "../strategy-reveal";

type Strategy = NonNullable<CmoOverview["strategy"]>;
type Entry = Strategy["calendar"][number];
type Measure = NonNullable<Strategy["funnel"]>[number]["measure"];

export type ConnectMeasurement = (
  provider: CmoOverview["measurement"][number]["provider"],
) => Promise<{ url: string | null; error: string | null }>;

export type PlanTab = "plan" | "month" | "results";

export const TABS: { id: PlanTab; label: string }[] = [
  { id: "plan", label: "Three moves" },
  { id: "month", label: "Your month" },
  { id: "results", label: "How we know it works" },
];

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** How many entries "Up first" lists. */
const UP_FIRST = 3;

interface PlanPanelProps {
  overview: CmoOverview;
  strategy: Strategy;
  /** Asks Cuso for another strategy; unset once the plan is approved. */
  onAsk?: (text: string, label?: string) => Promise<void>;
}

/**
 * Three moves (each stage's channels and what it measures), what stops
 * people buying, the mix of posts, the other plans Cuso weighed, the
 * topics and where he works; the rest sits under "Everything in the plan".
 */
export function PlanPanel({ overview, strategy, onAsk }: PlanPanelProps) {
  const stages = strategy.funnel ?? [];
  const mix = strategy.mix ?? [];
  const alternatives = strategy.alternatives ?? [];
  const [comparing, setComparing] = useState(false);
  const { barrier } = strategy;
  // Masumi chrome for the plan; the founder's brand colours stay off this
  // panel. Only the account previews (Your month) wear them.
  return (
    <div className="bb">
      {stages.length > 0 ? (
        <Section title="Three moves" wide>
          {stages.some((stage) => (stage.plays ?? []).length > 0) ? (
            <FunnelPlan
              stages={stages}
              improvements={strategy.improvements ?? []}
            />
          ) : (
            <Funnel stages={stages} />
          )}
        </Section>
      ) : null}
      {barrier ? (
        <Section title="What stops people buying">
          <div className="ob-barrier">
            <p className="ob-statement">{barrier.text}</p>
            {mix[0] ? (
              <p className="muted">
                So most posts {APPROACHES[mix[0].approach].so}.
              </p>
            ) : null}
          </div>
        </Section>
      ) : null}
      {mix.length > 0 ? (
        <Section title="What the posts do">
          <Mix
            mix={mix}
            calendar={strategy.calendar}
            business={businessDisplayName(overview)}
          />
        </Section>
      ) : null}
      {alternatives.length > 0 ? (
        <div className="ob-alts">
          <p>
            I also looked at {alternatives.length} other{" "}
            {alternatives.length === 1 ? "plan" : "plans"}.{" "}
            <button
              type="button"
              className="button button-ghost button-small"
              aria-expanded={comparing}
              onClick={() => setComparing(!comparing)}
            >
              {comparing ? "Hide them" : "Compare them"}
            </button>
          </p>
          {comparing ? (
            <Alternatives alternatives={alternatives} onAsk={onAsk} />
          ) : null}
        </div>
      ) : null}
      {strategy.pillars.length > 0 ? (
        <Section title="What the posts are about">
          <Pillars
            pillars={strategy.pillars}
            calendar={strategy.calendar}
            made={overview.production.pillars}
          />
        </Section>
      ) : null}
      <Section title={`Where ${AGENT_NAME} works`} wide>
        <ChannelPlan strategy={strategy} />
      </Section>
      <Everything strategy={strategy} />
    </div>
  );
}

/** The rest of the plan, closed until the founder wants it. */
function Everything({ strategy }: { strategy: Strategy }) {
  const improvements = strategy.improvements ?? [];
  const beforeAfter = strategy.beforeAfter ?? [];
  if (
    !strategy.ladder &&
    !strategy.why &&
    improvements.length === 0 &&
    beforeAfter.length === 0
  ) {
    return null;
  }
  return (
    <details className="ob-more">
      <summary>Everything in the plan</summary>
      {strategy.why ? (
        <Section title="Why this plan">
          <p>{strategy.why}</p>
        </Section>
      ) : null}
      {strategy.ladder ? (
        <Section title="The offer">
          <OfferLadder ladder={strategy.ladder} />
        </Section>
      ) : null}
      {beforeAfter.length > 0 ? (
        <Section title="Before and after" wide>
          <BeforeAfter rows={beforeAfter} />
        </Section>
      ) : null}
      {improvements.length > 0 ? (
        <Section title="What you can improve">
          <p className="note">
            {AGENT_NAME} doesn't control your pages, prices or checkout. These
            changes would help the funnel most.
          </p>
          <Improvements items={improvements} />
        </Section>
      ) : null}
    </details>
  );
}

interface MonthPanelProps {
  overview: CmoOverview;
  strategy: Strategy;
  /** Cuso is writing the plan: unwritten ads hold their place. */
  writing: boolean;
  onOpen: (entry: Entry) => void;
}

/**
 * What goes out first, week one day by day, what the founder's accounts will
 * look like, then the other weeks.
 */
export function MonthPanel({
  overview,
  strategy,
  writing,
  onOpen,
}: MonthPanelProps) {
  const weeks = useMemo(
    () => planWeeks(strategy.calendar),
    [strategy.calendar],
  );
  const byDay = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const entry of [...strategy.calendar].sort((a, b) =>
      (a.time ?? "").localeCompare(b.time ?? ""),
    )) {
      map.set(entry.date, [...(map.get(entry.date) ?? []), entry]);
    }
    return map;
  }, [strategy.calendar]);
  const first = useMemo(
    () =>
      [...strategy.calendar]
        .sort((a, b) =>
          `${a.date} ${a.time ?? ""}`.localeCompare(
            `${b.date} ${b.time ?? ""}`,
          ),
        )
        .slice(0, UP_FIRST),
    [strategy.calendar],
  );
  return (
    <div className="ob-month">
      {first.length > 0 ? (
        <div className="ob-upfirst">
          <h2>Up first</h2>
          <ul>
            {first.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  className="ob-entry"
                  onClick={() => onOpen(entry)}
                >
                  <span className="ob-entry-meta">
                    <ChannelIcon channel={entry.channel} size={12} />
                    {formatDay(entry.date, {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                    })}
                    {entry.time ? ` ${entry.time}` : ""}
                  </span>
                  <span className="ob-entry-title">
                    {withoutLabel(entry.hook ?? entry.title)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="ob-weeks">
        <div className="ob-weekdays" aria-hidden="true">
          {WEEKDAYS.map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        {weeks.slice(0, 1).map(weekRow)}
      </div>
      <AccountPreviews
        overview={overview}
        strategy={strategy}
        writing={writing}
      />
      {weeks.length > 1 ? (
        <div className="ob-weeks">
          {weeks.slice(1).map((week, index) => weekRow(week, index + 1))}
        </div>
      ) : null}
    </div>
  );

  function weekRow(week: (typeof weeks)[number], weekIndex: number) {
    return (
      <div key={week.start} className="ob-week">
        <span className="ob-week-label">Week {weekIndex + 1}</span>
        <div className="ob-days">
          {week.days.map((day) => {
            const entries = byDay.get(day) ?? [];
            const dayNumber = formatDay(day, { day: "numeric" });
            return (
              <div
                key={day}
                className={entries.length ? "ob-day" : "ob-day ob-day-blank"}
              >
                <span className="ob-day-n">
                  <span className="ob-day-short">
                    {dayNumber}
                    {dayNumber === "1"
                      ? ` ${formatDay(day, { month: "short" })}`
                      : ""}
                  </span>
                  <span className="ob-day-long">
                    {formatDay(day, {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                </span>
                {entries.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className="ob-entry"
                    onClick={() => onOpen(entry)}
                  >
                    <span className="ob-entry-meta">
                      <ChannelIcon channel={entry.channel} size={12} />
                      {entry.time ?? ""}
                    </span>
                    <span className="ob-entry-title">
                      {withoutLabel(entry.hook ?? entry.title)}
                    </span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    );
  }
}

function measureLine(measure: Measure): string {
  if (measure?.basis === "measured") {
    return `${measure.value ?? "Measured"}${measure.source ? `, from ${measure.source}` : ""}`;
  }
  if (measure?.basis === "estimated") {
    if (!measure.value) return "My estimate";
    // Cuso often says so himself: "(estimate; not measured)".
    return /estimat/i.test(measure.value)
      ? measure.value
      : `${measure.value} (my estimate)`;
  }
  return "Not measured yet";
}

/** What Cuso does on his own schedule; it matches his daily, weekly and monthly runs. */
const RHYTHM = [
  {
    icon: Sparkles,
    when: "Once you subscribe",
    what: [
      "Makes the whole month at once: every post, picture, video, ad, article and newsletter",
      "Schedules it all on your connected accounts",
      "You can change any piece, any time, by telling him",
    ],
  },
  {
    icon: Sun,
    when: "Every day",
    what: [
      "Replies to new comments on your Instagram, Facebook and YouTube posts, in your voice; complaints and anything sensitive come to you",
      "Checks the news: holidays, competitors, your market. When something matters, he changes a post",
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
interface ResultsPanelProps {
  overview: CmoOverview;
  strategy: Strategy;
  onConnectMeasurement: ConnectMeasurement;
}

export function ResultsPanel({
  overview,
  strategy,
  onConnectMeasurement,
}: ResultsPanelProps) {
  const { objective, measurement } = strategy;
  const stages = strategy.funnel ?? [];
  const rules = measurement?.rules ?? [];
  const tracking = measurement?.tracking ?? [];
  return (
    <div className="bb">
      <Section title="The outcome that matters">
        <p className="bb-big">{outcomeLine(strategy)}</p>
        {objective?.target ? (
          <p className="note">
            Target: {objective.target}
            {objective.baseline ? `. Today: ${objective.baseline}` : ""}
            {objective.baselineBasis === "assumption"
              ? " (my estimate until you tell me the real number)"
              : ""}
            .
          </p>
        ) : null}
      </Section>

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
          I read real visits, searches and orders from these. Where none of them
          reaches, I estimate and ask you for the number.
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

      {measurement?.sourceOfTruth ? (
        <Section title="Where sales are counted">
          <p className="bb-big">{measurement.sourceOfTruth}</p>
        </Section>
      ) : null}

      {measurement?.experiment ? (
        <Section title="This month's test">
          <ul className="bb-list">
            <li>
              <b>Change</b>
              <span>{measurement.experiment.change}</span>
            </li>
            <li>
              <b>Should move</b>
              <span>{measurement.experiment.expect}</span>
            </li>
            <li>
              <b>Judged by</b>
              <span>{measurement.experiment.judge}</span>
            </li>
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
  );
}
