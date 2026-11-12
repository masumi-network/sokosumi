"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { CMO_CHANNELS } from "@sokosumi/utils";
import { motion } from "motion/react";
import { AGENT_NAME } from "../lib/agent";
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
import { joinNames } from "../lib/names";
import { ChannelIcon } from "./channel-icon";
import { withoutLabel } from "./showcases";

type Strategy = NonNullable<CmoOverview["strategy"]>;
type Entry = Strategy["calendar"][number];

/** Every piece of the plan, earliest first, skipped ones left out. */
export function planPieces(calendar: Entry[]): Entry[] {
  return calendar
    .filter((entry) => entry.status !== "skipped")
    .sort((a, b) =>
      `${a.date}${a.time ?? ""}`.localeCompare(`${b.date}${b.time ?? ""}`),
    );
}
const EASE = [0.25, 1, 0.5, 1] as const;

type Approach = NonNullable<Strategy["mix"]>[number]["approach"];

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
export function Mix({
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

/**
 * The content pillars: each topic's share of the month, what it does, and
 * once the month is made, the share Cuso's pieces really have.
 */
export function Pillars({
  pillars,
  calendar,
  made,
}: {
  pillars: Strategy["pillars"];
  calendar: Entry[];
  made: CmoOverview["production"]["pillars"];
}) {
  const pieces = planPieces(calendar);
  return (
    <>
      {made ? (
        <p className="note">
          {made.rewriting
            ? `Some pieces read as another topic than planned. ${AGENT_NAME} is rewriting them now.`
            : `${AGENT_NAME} read every piece he made and counted what each one is really about.`}
        </p>
      ) : null}
      <ul className="bb-mix">
        {pillars.map((pillar) => {
          const mine = pieces.filter(
            (entry) =>
              entry.pillar?.trim().toLowerCase() ===
              pillar.name.trim().toLowerCase(),
          );
          const read = made?.shares.find((share) => share.name === pillar.name);
          const width = read ? read.made : pillar.share;
          return (
            <li key={pillar.name}>
              <div className="bb-mix-head">
                <b>{pillar.name}</b>
                <span className="num">
                  {read
                    ? `${read.made}% made · ${pillar.share}% planned`
                    : `${pillar.share}%`}
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
                {read ? (
                  <span
                    className="bb-bar-plan"
                    style={{ left: `${pillar.share}%` }}
                  />
                ) : null}
              </span>
              {pillar.why ? <span>{pillar.why}</span> : null}
              <span className="note">
                {mine.length} {mine.length === 1 ? "piece" : "pieces"} planned
                {mine[0] ? `, such as “${withoutLabel(mine[0].title)}”` : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

const GROUP_ORDER: ChannelGroup[] = ["social", "ads", "email", "search"];

/** "Image post" reads "3 image posts"; a name such as "YouTube Short" keeps its capitals. */
function plural(name: string, count: number): string {
  const lower = /[a-z][A-Z]/.test(name) ? name : name.toLowerCase();
  if (count === 1) return `1 ${lower}`;
  return `${count} ${/(x|s|sh|ch)$/.test(lower) ? `${lower}es` : `${lower}s`}`;
}

interface ChannelPlanProps {
  strategy: Strategy;
}

/**
 * Each channel of the plan: what Cuso makes there, counted from the
 * calendar, how often, and the one thing the founder does for it.
 */
export function ChannelPlan({ strategy }: ChannelPlanProps) {
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
                    <span className="cw-images">Images by {AGENT_NAME}</span>
                  ) : null}
                  {videos ? (
                    <span className="cw-images">Videos by {AGENT_NAME}</span>
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
          {AGENT_NAME} can also run {joinNames(more)}. Ask him to add one below.
          {soon.length > 0 ? ` ${joinNames(soon)} is coming soon.` : ""}
        </p>
      ) : null}
    </>
  );
}

/** "Qualified intro calls" becomes "More qualified intro calls"; a verb stays. */
/**
 * The plan's business outcome in words. Older plans named a metric instead,
 * and the oldest only goals.
 */
export function outcomeLine(strategy: Strategy): string {
  const objective = strategy.objective;
  if (objective?.outcome) return objective.outcome;
  if (objective?.metric) return goalLine(objective.metric);
  return strategy.goals[0] ?? "";
}

export function goalLine(metric: string): string {
  return /^(more|increase|grow|get|win|reach|raise|boost)\b/i.test(metric)
    ? metric
    : `More ${lowerFirst(metric)}`;
}

function lowerFirst(text: string): string {
  return /^[A-Z][a-z]/.test(text)
    ? `${text.charAt(0).toLowerCase()}${text.slice(1)}`
    : text;
}
