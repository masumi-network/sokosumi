"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { CMO_CHANNELS } from "@sokosumi/utils";
import { ArrowRight, ChevronDown, CircleCheck } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type ReactNode, useMemo, useState } from "react";

import { channelLabel, formatDay } from "../lib/calendar";
import {
  type ChannelGroup,
  channelInfo,
  channelKey,
  formatHasImage,
  formatHasVideo,
  formatName,
  GROUP_NAMES,
  OWNER_PART,
} from "../lib/channels";
import { AskForm, brandStyle, Section, SideSheet } from "./brand-profile";
import { businessDisplayName } from "./business-mark";
import { ChannelIcon } from "./channel-icon";
import { PhoneFeeds, planPieces } from "./phone-feeds";
import { withoutLabel } from "./showcases";
import { Funnel, Proposals } from "./strategy-funnel";

type Strategy = NonNullable<CmoOverview["strategy"]>;
type Entry = Strategy["calendar"][number];
type Campaign = NonNullable<Strategy["campaigns"]>[number];
type Point = { text: string; basis?: "fact" | "assumption" };
type Open =
  | { kind: "questions" }
  | { kind: "campaign"; campaign: Campaign }
  | { kind: "start" | "channels" | "journey" | "measure" }
  | null;

const DAY_MS = 86_400_000;
const EASE = [0.25, 1, 0.5, 1] as const;
const SHORT = { day: "numeric", month: "short" } as const;

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** Every day of the plan from its first piece, at least four weeks. */
export function planDays(calendar: Pick<Entry, "date">[]): string[] {
  const dates = calendar.map((entry) => entry.date).sort();
  const first = dates[0];
  if (!first) return [];
  const last = dates.at(-1) ?? first;
  const span =
    Math.round(
      (Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) /
        DAY_MS,
    ) + 1;
  return Array.from({ length: Math.min(Math.max(span, 28), 42) }, (_, index) =>
    addDays(first, index),
  );
}

interface StrategyRevealProps {
  overview: CmoOverview;
  /** The first look: the month plays itself once. */
  intro?: boolean;
  /** The day-by-day calendar, as the host lays it out. */
  calendar: ReactNode;
  /** Sends the owner's answer or request to Cuso. */
  onAsk?: (text: string) => Promise<void>;
}

/**
 * The strategy, answer first: the number in four weeks, what stops people
 * buying, the mix of posts that fixes it, and the month played forward.
 * Campaigns, weekly tasks and the reasoning sit under "The details".
 */
export function StrategyReveal({
  overview,
  intro = false,
  calendar,
  onAsk,
}: StrategyRevealProps) {
  const strategy = overview.strategy as Strategy;
  const reduce = useReducedMotion();
  const play = intro && !reduce;
  const [open, setOpen] = useState<Open>(null);
  const [details, setDetails] = useState(false);
  const questions = strategy.openQuestions ?? [];
  const campaigns = strategy.campaigns ?? [];
  const weeks = strategy.weeks ?? [];
  const mix = strategy.mix ?? [];
  const days = useMemo(() => planDays(strategy.calendar), [strategy.calendar]);
  const { objective, barrier } = strategy;
  const beat = (at: number) =>
    play
      ? {
          initial: { opacity: 0, y: 12 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.5, delay: 0.2 + at * 0.12, ease: EASE },
        }
      : {};

  return (
    <div className="bb" style={brandStyle(overview)}>
      <motion.header className="bb-hero" {...beat(0)}>
        <p className="bb-eyebrow">
          Your next {Math.round(days.length / 7)} weeks
        </p>
        <h1 className="bb-line">
          {objective ? goalLine(objective.metric) : strategy.goals[0]}
        </h1>
        <p className="bb-lede">{strategy.summary}</p>
      </motion.header>

      {onAsk && questions.length > 0 ? (
        <motion.button
          type="button"
          className="bb-callout bb-callout-button"
          onClick={() => setOpen({ kind: "questions" })}
          {...beat(1)}
        >
          <span>
            <b>
              {questions.length}{" "}
              {questions.length === 1 ? "question" : "questions"} to make this
              plan fit.
            </b>{" "}
            A line each is enough.
          </span>
          <span className="bb-link">
            Answer <ArrowRight size={14} aria-hidden="true" />
          </span>
        </motion.button>
      ) : null}

      {(strategy.funnel ?? []).length > 0 ? (
        <Section title="How people become customers" wide beat={beat(2)}>
          <Funnel stages={strategy.funnel ?? []} />
        </Section>
      ) : null}

      <Section title="Your month" wide beat={beat(2)}>
        <p className="note">
          {pieceCount(strategy.calendar)} Nothing goes out until you approve.
        </p>
        <PhoneFeeds overview={overview} strategy={strategy} play={play} />
      </Section>

      {barrier ? (
        <Section title="What stops people buying" beat={beat(3)}>
          <p className="bb-big">{barrier.text}</p>
          {mix[0] ? (
            <p className="note">
              So most posts {APPROACHES[mix[0].approach].so}.
            </p>
          ) : null}
        </Section>
      ) : null}

      {mix.length > 0 ? (
        <Section title="What the posts do" beat={beat(4)}>
          <Mix
            mix={mix}
            calendar={strategy.calendar}
            business={businessDisplayName(overview)}
          />
        </Section>
      ) : null}

      <Section title="Where Cuso works" beat={beat(5)} wide>
        <ChannelPlan strategy={strategy} />
      </Section>

      {(strategy.proposals ?? []).length > 0 ? (
        <Section title="Channels you could add" beat={beat(5)} wide>
          <p className="note">
            Cuso runs these too. They're not in the plan because you don't have
            them set up yet. Add one and he starts on it.
          </p>
          <Proposals proposals={strategy.proposals ?? []} />
        </Section>
      ) : null}

      {strategy.pillars.length > 0 ? (
        <Section title="Topics" beat={beat(5)}>
          <p className="bb-big">{strategy.pillars.join(" · ")}</p>
        </Section>
      ) : null}

      <Section title="Your calendar" wide beat={beat(6)}>
        {calendar}
      </Section>

      <motion.div className="bb-more" {...beat(7)}>
        <button
          type="button"
          className="bb-toggle"
          aria-expanded={details}
          onClick={() => setDetails(!details)}
        >
          {details ? "Hide the details" : "The details"}
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        {details ? (
          <div className="bb-all">
            <Basics strategy={strategy} />
            {campaigns.length > 0 ? (
              <Section title="Campaigns" wide>
                <div className="ff-campaigns">
                  {campaigns.map((campaign) => (
                    <CampaignCard
                      key={campaign.id}
                      campaign={campaign}
                      days={days}
                      pieces={
                        strategy.calendar.filter(
                          (entry) => entry.campaignId === campaign.id,
                        ).length
                      }
                      onOpen={() => setOpen({ kind: "campaign", campaign })}
                    />
                  ))}
                </div>
              </Section>
            ) : null}
            {weeks.length > 0 ? (
              <Section title="Week by week" wide>
                <ol className="ff-weeks">
                  {weeks.map((week, index) => (
                    <li key={week.focus} className="ff-week">
                      <p className="ff-week-head">
                        <b>Week {index + 1}</b>
                        {days[index * 7] ? (
                          <span className="note num">
                            {formatDay(days[index * 7] as string, SHORT)}
                          </span>
                        ) : null}
                      </p>
                      <p className="ff-week-focus">{week.focus}</p>
                      <ul className="ff-tasks">
                        {(week.tasks ?? []).map((task) => (
                          <li key={task.task}>
                            <span className={`ff-owner ${task.owner}`}>
                              {task.owner === "you" ? "You" : "Cuso"}
                            </span>
                            <span>
                              {task.task}
                              {task.approval ? (
                                <span className="ff-needs">Needs you</span>
                              ) : null}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ol>
              </Section>
            ) : null}
            <Behind strategy={strategy} onOpen={(kind) => setOpen({ kind })} />
          </div>
        ) : null}
      </motion.div>

      <AnimatePresence>
        {open ? (
          <SideSheet
            key={open.kind === "campaign" ? open.campaign.id : open.kind}
            label={SHEET_LABELS[open.kind]}
            onClose={() => setOpen(null)}
          >
            <SheetBody
              open={open}
              strategy={strategy}
              questions={questions}
              onAsk={onAsk}
            />
          </SideSheet>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

type Approach = NonNullable<Strategy["mix"]>[number]["approach"];

/** Each approach in plain words: its name, what it is, and what posts then do. */
/** Each kind of post in plain words: its name, and what it does for the owner. */
export const APPROACHES: Record<
  Approach,
  { name: string; does: string; so: string }
> = {
  educational: {
    name: "Helpful tips",
    does: "Posts that solve a small problem for your buyers. People trust whoever helps them first.",
    so: "teach",
  },
  "thought-leadership": {
    name: "Your point of view",
    does: "Posts with a clear opinion on your field. They make you the expert people quote.",
    so: "share a point of view",
  },
  "problem-solution": {
    name: "Problem and fix",
    does: "Posts that name a pain your buyers feel, then show the way out.",
    so: "name the problem and show the fix",
  },
  "product-led": {
    name: "Your product at work",
    does: "Posts that show what you sell doing its job, so buyers can picture using it.",
    so: "show the product at work",
  },
  "social-proof": {
    name: "Customer proof",
    does: "Posts with real customers and results. They answer: does it work for people like me?",
    so: "show proof from customers",
  },
  "people-led": {
    name: "Behind the scenes",
    does: "Posts about you and your team. People buy from people they know.",
    so: "put the people behind it first",
  },
  "community-led": {
    name: "Conversation",
    does: "Posts that ask and answer, so buyers talk with you instead of scrolling past.",
    so: "get people talking",
  },
  entertainment: {
    name: "Fun",
    does: "Light posts people enjoy and share. They keep your name in mind.",
    so: "make people smile and remember",
  },
  "research-led": {
    name: "Data",
    does: "Posts with numbers only you have. Others quote them and link to you.",
    so: "share data no one else has",
  },
  promotional: {
    name: "Offers",
    does: "Posts that ask for one action, like a trial or a call.",
    so: "ask for one action",
  },
};

/** The kinds of posts this month: how many of each, what they do, one real example. */
function Mix({
  mix,
  calendar,
  business,
}: {
  mix: NonNullable<Strategy["mix"]>;
  calendar: Entry[];
  business: string;
}) {
  const pieces = planPieces(calendar);
  return (
    <ul className="bb-mix">
      {mix.map((part) => {
        const mine = pieces.filter((entry) => entry.approach === part.approach);
        const example = mine[0];
        // The bar shows what the calendar holds; the planned share until it does.
        const width = mine.length
          ? Math.round((mine.length / pieces.length) * 100)
          : part.share;
        return (
          <li key={part.approach}>
            <div className="bb-mix-head">
              <b>{APPROACHES[part.approach].name}</b>
              <span className="num">
                {mine.length > 0
                  ? `${mine.length} ${mine.length === 1 ? "piece" : "pieces"}`
                  : `${part.share}%`}
              </span>
            </div>
            <span className="bb-bar" aria-hidden="true">
              <motion.i
                style={{ width: `${width}%` }}
                initial={{ scaleX: 0 }}
                whileInView={{ scaleX: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, ease: EASE }}
              />
            </span>
            <span>{APPROACHES[part.approach].does}</span>
            <span className="note">
              For {business}: {lowerFirst(part.why)}
            </span>
            {example ? (
              <span className="note">
                Example: “{withoutLabel(example.title)}”
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

const GROUP_ORDER: ChannelGroup[] = ["social", "ads", "email", "search"];

function plural(name: string, count: number): string {
  const lower = name.toLowerCase();
  if (count === 1) return `1 ${lower}`;
  return `${count} ${/(x|s|sh|ch)$/.test(lower) ? `${lower}es` : `${lower}s`}`;
}

/**
 * Each channel of the plan: what Cuso makes there, counted from the
 * calendar, how often, and the one thing the founder does for it.
 */
function ChannelPlan({ strategy }: { strategy: Strategy }) {
  const channels = strategy.channels
    .map((channel) => ({ ...channel, key: channelKey(channel.channel) }))
    .filter(
      (channel): channel is typeof channel & { key: string } =>
        channel.key !== null && channelInfo(channel.key)?.status === "live",
    )
    .sort(
      (a, b) =>
        GROUP_ORDER.indexOf(channelInfo(a.key)?.group ?? "social") -
        GROUP_ORDER.indexOf(channelInfo(b.key)?.group ?? "social"),
    );
  const used = new Set(channels.map((channel) => channel.key));
  const more = (Object.keys(CMO_CHANNELS) as (keyof typeof CMO_CHANNELS)[])
    .filter((key) => CMO_CHANNELS[key].status === "live" && !used.has(key))
    .map((key) => CMO_CHANNELS[key].name);
  const soon = (Object.keys(CMO_CHANNELS) as (keyof typeof CMO_CHANNELS)[])
    .filter((key) => CMO_CHANNELS[key].status === "soon")
    .map((key) => CMO_CHANNELS[key].name);
  return (
    <>
      <ul className="cw-grid">
        {channels.map((channel) => {
          const info = channelInfo(channel.key);
          if (!info) return null;
          const entries = strategy.calendar.filter(
            (entry) =>
              channelKey(entry.channel) === channel.key &&
              entry.status !== "skipped",
          );
          const formats = new Map<string, number>();
          for (const entry of entries) {
            const name = formatName(channel.key, entry.format);
            formats.set(name, (formats.get(name) ?? 0) + 1);
          }
          const images = entries.some((entry) =>
            formatHasImage(channel.key, entry.format),
          );
          const videos = entries.some((entry) =>
            formatHasVideo(channel.key, entry.format),
          );
          return (
            <li key={channel.key} className="cw-card">
              <div className="cw-head">
                <span className="cw-icon">
                  <ChannelIcon channel={channel.key} size={22} />
                </span>
                <div>
                  <p className="cw-name">{info.name}</p>
                  <p className="note">
                    {GROUP_NAMES[info.group] === info.name
                      ? channel.cadence
                      : `${GROUP_NAMES[info.group]} · ${channel.cadence}`}
                  </p>
                </div>
              </div>
              {formats.size > 0 ? (
                <p className="cw-makes">
                  {[...formats]
                    .map(([name, count]) => plural(name, count))
                    .join(", ")}
                  {images ? (
                    <span className="cw-images">Images by Cuso</span>
                  ) : null}
                  {videos ? (
                    <span className="cw-images">Videos by Cuso</span>
                  ) : null}
                </p>
              ) : null}
              {channel.why ? <p className="note">{channel.why}</p> : null}
              <p className="cw-you">{OWNER_PART[info.owner]}</p>
            </li>
          );
        })}
      </ul>
      {more.length > 0 ? (
        <p className="note">
          Cuso can also run {joinNames(more)}. Ask him to add one below.
          {soon.length > 0 ? ` ${joinNames(soon)} is coming soon.` : ""}
        </p>
      ) : null}
    </>
  );
}

/** "A, B and C". */
function joinNames(names: string[]): string {
  return names.length > 1
    ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
    : (names[0] ?? "");
}

/** Who the month is for and what it offers them. */
function Basics({ strategy }: { strategy: Strategy }) {
  const { focus, offer } = strategy;
  return (
    <>
      {strategy.why ? (
        <Section title="Why this plan">
          <p>{strategy.why}</p>
        </Section>
      ) : null}
      {focus || strategy.audience ? (
        <Section title="Who it's for">
          <p className="bb-big">{focus?.segment ?? strategy.audience}</p>
          {focus ? <p>{focus.problem}</p> : null}
          {focus?.trigger ? (
            <p className="note">They look when {lowerFirst(focus.trigger)}</p>
          ) : null}
        </Section>
      ) : null}
      {offer ? (
        <Section title="The offer">
          <p className="bb-big">{offer.what}</p>
          <p>{offer.why}</p>
          <p className="note">Next step: {lowerFirst(offer.action)}</p>
        </Section>
      ) : null}
    </>
  );
}

const SHEET_LABELS = {
  questions: "What Cuso assumed",
  campaign: "Campaign",
  start: "Where you start",
  channels: "Why these channels",
  journey: "After the click",
  measure: "Budget and measurement",
} as const;

/** "Qualified intro calls" becomes "More qualified intro calls"; a verb stays. */
export function goalLine(metric: string): string {
  return /^(more|increase|grow|get|win|reach|raise|boost)\b/i.test(metric)
    ? metric
    : `More ${lowerFirst(metric)}`;
}

function pieceCount(calendar: Entry[]): string {
  const pieces = planPieces(calendar);
  const images = pieces.filter((entry) =>
    formatHasImage(entry.channel, entry.format),
  ).length;
  return `${pieces.length} ${pieces.length === 1 ? "piece" : "pieces"}${images ? `, ${images} with images by Cuso` : ""}.`;
}

function lowerFirst(text: string): string {
  return /^[A-Z][a-z]/.test(text)
    ? `${text.charAt(0).toLowerCase()}${text.slice(1)}`
    : text;
}

function CampaignCard({
  campaign,
  days,
  pieces,
  onOpen,
}: {
  campaign: Campaign;
  days: string[];
  pieces: number;
  onOpen: () => void;
}) {
  const at = (date: string) => {
    const index = days.indexOf(date);
    return index < 0 ? (date < (days[0] ?? "") ? 0 : days.length) : index;
  };
  const left = (at(campaign.start) / days.length) * 100;
  const width = Math.max(
    ((at(campaign.end) + 1 - at(campaign.start)) / days.length) * 100,
    4,
  );
  return (
    <button type="button" className="ff-campaign" onClick={onOpen}>
      <span className="ff-campaign-name">{campaign.name}</span>
      <span className="ff-campaign-message">{campaign.message}</span>
      <span className="ff-span" aria-hidden="true">
        <motion.i
          style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
          initial={{ scaleX: 0 }}
          whileInView={{ scaleX: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: EASE }}
        />
      </span>
      <span className="ff-campaign-meta">
        <span className="note num">
          {formatDay(campaign.start, SHORT)} to {formatDay(campaign.end, SHORT)}
        </span>
        <span className="ff-icons">
          {(campaign.channels ?? []).map((channel) => (
            <ChannelIcon key={channel} channel={channel} size={14} />
          ))}
        </span>
      </span>
      <span className="ff-campaign-metric">
        <CircleCheck size={14} aria-hidden="true" />
        {campaign.metric}
        {pieces > 0 ? <span className="note"> · {pieces} pieces</span> : null}
      </span>
    </button>
  );
}

/** The reasoning behind the plan, one card each, the detail in a sheet. */
function Behind({
  strategy,
  onOpen,
}: {
  strategy: Strategy;
  onOpen: (kind: "start" | "channels" | "journey" | "measure") => void;
}) {
  const start = strategy.start;
  const journey = strategy.journey ?? [];
  const tiles = [
    start
      ? {
          kind: "start" as const,
          question: "Where do you start?",
          headline:
            start.gaps?.[0]?.text ??
            start.working?.[0]?.text ??
            "Today, in brief",
        }
      : null,
    strategy.channels.length > 0
      ? {
          kind: "channels" as const,
          question: "Why these channels?",
          headline: strategy.channels
            .map((channel) => channelLabel(channel.channel))
            .join(", "),
        }
      : null,
    journey.length > 0
      ? {
          kind: "journey" as const,
          question: "What happens after the click?",
          headline:
            journey.find((step) => step.fix)?.fix ??
            `${journey.length} steps to ${lowerFirst(journey.at(-1)?.step ?? "")}`,
        }
      : null,
    strategy.budget || strategy.measurement
      ? {
          kind: "measure" as const,
          question: "What does it cost, and how do we know?",
          headline:
            strategy.budget?.total ?? strategy.measurement?.primary ?? "",
        }
      : null,
  ].filter((tile) => tile !== null);
  if (tiles.length === 0) return null;
  return (
    <Section title="Behind the plan" wide>
      <div className="rv-tiles">
        {tiles.map((tile) => (
          <button
            key={tile.kind}
            type="button"
            className="rv-tile"
            onClick={() => onOpen(tile.kind)}
          >
            <span className="rv-tile-q">{tile.question}</span>
            <span className="rv-tile-h">{tile.headline}</span>
          </button>
        ))}
      </div>
    </Section>
  );
}

function SheetBody({
  open,
  strategy,
  questions,
  onAsk,
}: {
  open: NonNullable<Open>;
  strategy: Strategy;
  questions: string[];
  onAsk?: (text: string) => Promise<void>;
}) {
  switch (open.kind) {
    case "questions":
      return (
        <>
          <h3 className="sheet-title">What Cuso assumed</h3>
          <ul className="rv-question-list">
            {questions.map((question) => (
              <li key={question}>
                <p>{question}</p>
                {onAsk ? (
                  <AskForm
                    cta="Answer"
                    placeholder="Your answer"
                    sentNote="Sent. Cuso updates the plan in about two minutes."
                    onAsk={(answer) =>
                      onAsk(`Answer for my strategy: “${question}” ${answer}`)
                    }
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </>
      );
    case "campaign": {
      const { campaign } = open;
      const pieces = strategy.calendar.filter(
        (entry) => entry.campaignId === campaign.id,
      );
      return (
        <>
          <h3 className="sheet-title">{campaign.name}</h3>
          <p className="rv-sheet-headline">{campaign.message}</p>
          <Facts
            rows={[
              [
                "When",
                `${formatDay(campaign.start, SHORT)} to ${formatDay(campaign.end, SHORT)}`,
              ],
              ["For", campaign.audience],
              ["Offer", campaign.offer],
              [
                "Channels",
                (campaign.channels ?? []).map(channelLabel).join(", "),
              ],
              ["Budget", campaign.budget],
              ["Success", campaign.metric],
            ]}
          />
          {(campaign.assets ?? []).length > 0 ? (
            <List title="What it needs" items={campaign.assets ?? []} />
          ) : null}
          {pieces.length > 0 ? (
            <List
              title="Pieces in the calendar"
              items={pieces.map(
                (entry) =>
                  `${formatDay(entry.date, SHORT)} · ${channelLabel(entry.channel)} · ${entry.title}`,
              )}
            />
          ) : null}
        </>
      );
    }
    case "start": {
      const start = strategy.start;
      if (!start) return null;
      return (
        <>
          <h3 className="sheet-title">Where you start</h3>
          <Points title="What works" points={start.working ?? []} />
          <Points title="The biggest gaps" points={start.gaps ?? []} />
          <Points
            title="What there is to work with"
            points={start.resources ?? []}
          />
        </>
      );
    }
    case "channels":
      return (
        <>
          <h3 className="sheet-title">Why these channels</h3>
          <ul className="ff-sheet-list">
            {strategy.channels.map((channel) => (
              <li key={channel.channel}>
                <p className="ff-sheet-row">
                  <ChannelIcon channel={channel.channel} size={16} />
                  <b>{channelLabel(channel.channel)}</b>
                  <span className="note">{channel.cadence}</span>
                </p>
                {channel.why ? <p>{channel.why}</p> : null}
              </li>
            ))}
          </ul>
        </>
      );
    case "journey":
      return (
        <>
          <h3 className="sheet-title">After the click</h3>
          <ol className="ff-journey">
            {(strategy.journey ?? []).map((step) => (
              <li key={step.step}>
                <p>{step.step}</p>
                {step.fix ? <p className="ff-fix">Fix: {step.fix}</p> : null}
              </li>
            ))}
          </ol>
        </>
      );
    case "measure": {
      const { budget, measurement } = strategy;
      return (
        <>
          <h3 className="sheet-title">Budget and measurement</h3>
          {budget ? (
            <>
              <p className="rv-sheet-headline">
                {budget.total}
                {budget.basis === "assumption" ? (
                  <span className="ff-assumed"> · assumed</span>
                ) : null}
              </p>
              {(budget.lines ?? []).length > 0 ? (
                <Facts
                  rows={(budget.lines ?? []).map((line) => [
                    line.item,
                    line.amount,
                  ])}
                />
              ) : null}
            </>
          ) : null}
          {measurement ? (
            <>
              <Facts
                rows={[
                  ["Primary", measurement.primary],
                  [
                    "Also",
                    (measurement.supporting ?? []).join(", ") || undefined,
                  ],
                ]}
              />
              {(measurement.tracking ?? []).length > 0 ? (
                <List title="To set up" items={measurement.tracking ?? []} />
              ) : null}
              {(measurement.rules ?? []).length > 0 ? (
                <List
                  title="When to change course"
                  items={(measurement.rules ?? []).map(
                    (rule) => `${rule.when}: ${lowerFirst(rule.then)}`,
                  )}
                />
              ) : null}
            </>
          ) : null}
        </>
      );
    }
  }
}

function Facts({ rows }: { rows: [string, string | undefined][] }) {
  return (
    <dl className="ff-facts">
      {rows
        .filter((row): row is [string, string] => Boolean(row[1]))
        .map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
    </dl>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <>
      <p className="label ff-sheet-label">{title}</p>
      <ul className="ff-sheet-list">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </>
  );
}

function Points({ title, points }: { title: string; points: Point[] }) {
  if (points.length === 0) return null;
  return (
    <>
      <p className="label ff-sheet-label">{title}</p>
      <ul className="ff-sheet-list">
        {points.map((point) => (
          <li key={point.text}>
            {point.text}
            {point.basis === "assumption" ? (
              <span className="ff-assumed"> · assumed</span>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}
