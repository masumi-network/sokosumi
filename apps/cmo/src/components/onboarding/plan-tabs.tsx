"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import {
  ArrowRight,
  CalendarDays,
  Film,
  Image,
  Images,
  Info,
  PenLine,
  Repeat,
  Sun,
} from "lucide-react";
import { useMemo, useState } from "react";
import { AGENT_NAME } from "../../lib/agent";
import { formatDay, planWeeks } from "../../lib/calendar";
import { formatMedia } from "../../lib/channels";
import { monthLabel } from "../../lib/strategy";
import { brandStyle, Section } from "../brand-profile";
import { businessDisplayName } from "../business-mark";
import { ChannelIcon } from "../channel-icon";
import { PhoneFeeds } from "../phone-feeds";
import { withoutLabel } from "../showcases";
import {
  Alternatives,
  BeforeAfter,
  FunnelPlan,
  Improvements,
  MeasureFunnel,
  OfferLadder,
  stageLabel,
} from "../strategy-core";
import {
  APPROACHES,
  ChannelPlan,
  Mix,
  outcomeLine,
  Topics,
} from "../strategy-reveal";

type Strategy = NonNullable<CmoOverview["strategy"]>;
type Entry = Strategy["calendar"][number];
type Measure = NonNullable<Strategy["funnel"]>[number]["measure"];

export type ConnectMeasurement = (
  provider: CmoOverview["measurement"][number]["provider"],
) => Promise<{ url: string | null; error: string | null }>;

export type PlanTab = "plan" | "month" | "results";

export const TABS: { id: PlanTab; label: string }[] = [
  { id: "plan", label: "Your funnel" },
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
 * The funnel (each stage's step, goal and channels), where the posts show
 * up, what stops people buying, the mix of posts, the other plans Cuso
 * weighed, the topics and where he works; the rest sits under "Everything in
 * the plan".
 */
export function PlanPanel({ overview, strategy, onAsk }: PlanPanelProps) {
  const stages = strategy.funnel ?? [];
  const mix = strategy.mix ?? [];
  const alternatives = strategy.alternatives ?? [];
  const [comparing, setComparing] = useState(false);
  const { barrier } = strategy;
  // Masumi chrome for the plan; the founder's brand colours stay off this
  // panel (they used to tint the whole `.bb` via brandStyle — Brand Brain
  // leftover). Phone mockups below still take brandStyle so posts look like
  // theirs.
  return (
    <div className="bb">
      {stages.length > 0 ? (
        <Section title="Your funnel" wide>
          <p className="note">
            How strangers become customers. Every network helps at every step.
          </p>
          <FunnelPlan stages={stages} calendar={strategy.calendar} />
        </Section>
      ) : null}
      {strategy.calendar.length > 0 ? (
        <Section title="Where it shows up" wide>
          <div style={brandStyle(overview)}>
            <PhoneFeeds overview={overview} strategy={strategy} />
          </div>
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
          <Topics pillars={strategy.pillars} />
        </Section>
      ) : null}
      {alternatives.length > 0 ? (
        <div className="ob-alts">
          <p>
            I also looked at {alternatives.length} other{" "}
            {alternatives.length === 1 ? "strategy" : "strategies"}.{" "}
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
      <Section title={`Where ${AGENT_NAME} works`} wide>
        <ChannelPlan strategy={strategy} />
      </Section>
      <Everything strategy={strategy} />
    </div>
  );
}

/** The rest of the plan, closed until the founder wants it. */
function Everything({ strategy }: Pick<PlanPanelProps, "strategy">) {
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
      <summary>Everything in the strategy</summary>
      {strategy.why ? (
        <Section title="Why this strategy">
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
  strategy: Strategy;
  onOpen: (entry: Entry) => void;
  /** Before approval: the pieces are topics, made once the plan is approved. */
  pending?: boolean;
}

const MEDIA = {
  video: { icon: Film, label: "Video" },
  images: { icon: Images, label: "Several images" },
  image: { icon: Image, label: "Image" },
} as const;

/** One piece on the calendar: channel, time, its media, title and pillar. */
function EntryButton({
  entry,
  day,
  pending,
  onOpen,
}: {
  entry: Entry;
  /** Shows the date too (Up first). */
  day?: boolean;
  pending: boolean;
  onOpen: (entry: Entry) => void;
}) {
  const media = formatMedia(entry.channel, entry.format);
  const Media = media ? MEDIA[media].icon : null;
  return (
    <button
      type="button"
      className={
        pending && entry.status === "idea" ? "ob-entry pending" : "ob-entry"
      }
      onClick={() => onOpen(entry)}
    >
      <span className="ob-entry-meta">
        <ChannelIcon channel={entry.channel} size={12} />
        {day
          ? `${formatDay(entry.date, { weekday: "short", day: "numeric", month: "short" })}${entry.time ? ` ${entry.time}` : ""}`
          : (entry.time ?? "")}
        {Media && media ? (
          <Media
            size={12}
            className="ob-entry-media"
            aria-label={MEDIA[media].label}
          />
        ) : null}
      </span>
      <span className="ob-entry-title">
        {withoutLabel(entry.hook ?? entry.title)}
      </span>
      {entry.pillar ? (
        <span className="ob-entry-pillar">{entry.pillar}</span>
      ) : null}
    </button>
  );
}

/** What goes out first, then every day of the plan. */
export function MonthPanel({
  strategy,
  onOpen,
  pending = false,
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
  const counts = useMemo(() => {
    const media = strategy.calendar.map((entry) =>
      formatMedia(entry.channel, entry.format),
    );
    return {
      pictures: media.filter((kind) => kind === "image" || kind === "images")
        .length,
      videos: media.filter((kind) => kind === "video").length,
    };
  }, [strategy.calendar]);
  return (
    <div className="ob-month">
      {pending ? (
        <div className="ob-month-pending">
          <Info size={16} aria-hidden="true" />
          <p>
            <b>These are the topics.</b> Once you approve, I write every post
            and make its pictures and videos.
          </p>
          <p className="ob-month-counts num">
            {[
              monthLabel(strategy.calendar),
              counts.pictures > 0 ? `${counts.pictures} with pictures` : "",
              counts.videos > 0
                ? `${counts.videos} ${counts.videos === 1 ? "video" : "videos"}`
                : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      ) : null}
      {first.length > 0 ? (
        <div className="ob-upfirst">
          <h2>Up first</h2>
          <ul>
            {first.map((entry) => (
              <li key={entry.id}>
                <EntryButton
                  entry={entry}
                  day
                  pending={pending}
                  onOpen={onOpen}
                />
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
        {weeks.map((week, weekIndex) => (
          <div key={week.start} className="ob-week">
            <span className="ob-week-label">Week {weekIndex + 1}</span>
            <div className="ob-days">
              {week.days.map((day) => {
                const entries = byDay.get(day) ?? [];
                const dayNumber = formatDay(day, { day: "numeric" });
                return (
                  <div
                    key={day}
                    className={
                      entries.length ? "ob-day" : "ob-day ob-day-blank"
                    }
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
                      <EntryButton
                        key={entry.id}
                        entry={entry}
                        pending={pending}
                        onOpen={onOpen}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
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
  return "Counted once your accounts are connected";
}

/** What Cuso does on his own schedule; it matches his daily, weekly and monthly runs. */
const RHYTHM = [
  {
    icon: PenLine,
    when: "Once you approve",
    does: "I make the whole month",
    detail:
      "Every post, picture, video and article, scheduled on your accounts.",
  },
  {
    icon: Sun,
    when: "Every day",
    does: "I keep it running",
    detail:
      "I answer comments in your voice, watch the news and send you one line on what went out.",
  },
  {
    icon: Repeat,
    when: "Every Monday",
    does: "I check the numbers",
    detail: "Real numbers only. More of what works, less of what doesn't.",
  },
  {
    icon: CalendarDays,
    when: "Every month",
    does: "I plan the next month",
    detail: "From what worked, toward the same goal.",
  },
];

/** How Cuso works, as four steps on a line, with the owner in control. */
function HowItWorks() {
  return (
    <div className="ob-how">
      <ol className="ob-rhythm">
        {RHYTHM.map(({ icon: Icon, when, does, detail }) => (
          <li key={when}>
            <span className="ob-rhythm-icon" aria-hidden="true">
              <Icon size={16} />
            </span>
            <span className="ob-rhythm-when">{when}</span>
            <b>{does}</b>
            <span className="note">{detail}</span>
          </li>
        ))}
      </ol>
      <p className="note">
        You stay in control: change, pause or undo any post by telling me.
        Complaints and anything sensitive come to you.
      </p>
    </div>
  );
}

/**
 * How the founder will know the plan works: the numbers Cuso tracks at each
 * stage, what he does every day, week and month, and when he changes course.
 */
interface ResultsPanelProps {
  overview: CmoOverview;
  strategy: Strategy;
  onConnectMeasurement: ConnectMeasurement;
  measureError?: string | null;
}

export function ResultsPanel({
  overview,
  strategy,
  onConnectMeasurement,
  measureError = null,
}: ResultsPanelProps) {
  const { objective, measurement } = strategy;
  const stages = strategy.funnel ?? [];
  const rules = measurement?.rules ?? [];
  const tracking = measurement?.tracking ?? [];
  return (
    <div className="bb">
      <Section title="How it works" wide>
        <HowItWorks />
      </Section>

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
                <span className="note">{stageLabel(stage.stage)}</span>
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
          measureError={measureError}
        />
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
