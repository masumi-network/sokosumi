"use client";

import "./phone-feeds.css";

import type { CmoOverview } from "@sokosumi/core-client";
import { ImageIcon, Play } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { channelInfo, channelKey, formatHasVideo } from "../lib/channels";
import { BusinessMark, businessDisplayName } from "./business-mark";
import { ChannelIcon } from "./channel-icon";

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

/** One phone per place the month shows up: a network, ads, the inbox, Google. */
type Screen = {
  key: string;
  name: string;
  icon: string;
  one: string;
  many: string;
  entries: Entry[];
  /** A proposed channel: shown as what the month could add, per month. */
  optional?: boolean;
  perMonth?: number;
};

const SCREENS: Omit<Screen, "entries">[] = [
  {
    key: "youtube",
    name: "YouTube",
    icon: "youtube",
    one: "YouTube Short",
    many: "YouTube Shorts",
  },
  {
    key: "linkedin",
    name: "LinkedIn",
    icon: "linkedin",
    one: "LinkedIn post",
    many: "LinkedIn posts",
  },
  {
    key: "instagram",
    name: "Instagram",
    icon: "instagram",
    one: "Instagram post",
    many: "Instagram posts",
  },
  { key: "x", name: "X", icon: "x", one: "post on X", many: "posts on X" },
  {
    key: "facebook",
    name: "Facebook",
    icon: "facebook",
    one: "Facebook post",
    many: "Facebook posts",
  },
  { key: "ads", name: "Ads", icon: "meta_ads", one: "ad", many: "ads" },
  {
    key: "newsletter",
    name: "Inbox",
    icon: "newsletter",
    one: "newsletter email",
    many: "newsletter emails",
  },
  {
    key: "seo",
    name: "Google",
    icon: "seo",
    one: "website piece",
    many: "website pieces",
  },
];

function screenKey(entry: Entry): string {
  const channel = channelKey(entry.channel) ?? entry.channel;
  return channelInfo(channel)?.group === "ads" ? "ads" : channel;
}

/** The busiest places first, up to four phones. */
export function feedScreens(calendar: Entry[]): Screen[] {
  const pieces = planPieces(calendar);
  return SCREENS.map((screen) => ({
    ...screen,
    entries: pieces.filter((entry) => screenKey(entry) === screen.key),
  }))
    .filter((screen) => screen.entries.length > 0)
    .sort((a, b) => b.entries.length - a.entries.length)
    .slice(0, 4);
}

/**
 * A proposed channel as a phone of stand-in pieces in its own formats, so the
 * founder sees what adding it would bring.
 */
export function proposalScreens(strategy: Strategy): Screen[] {
  return (strategy.proposals ?? []).flatMap((proposal) => {
    const formats = Object.keys(channelInfo(proposal.channel)?.formats ?? {});
    const base = SCREENS.find(
      (screen) =>
        screen.key === screenKey({ channel: proposal.channel } as Entry),
    );
    if (!base || formats.length === 0) return [];
    const count = Math.min(proposal.perMonth, 6);
    const entries = Array.from({ length: count }, (_, index) => ({
      id: `${proposal.channel}-${index}`,
      date: "",
      channel: proposal.channel,
      format: formats[index % formats.length] as string,
      title: "",
      status: "idea" as const,
    })) as Entry[];
    return [
      {
        ...base,
        key: `optional-${proposal.channel}`,
        icon: proposal.channel,
        entries,
        optional: true,
        perMonth: proposal.perMonth,
      },
    ];
  });
}

/**
 * The month on the founder's phones: each feed scrolls through what Cuso
 * makes there, as placeholders in that network's shape.
 */
export function PhoneFeeds({
  overview,
  strategy,
  play,
}: {
  overview: CmoOverview;
  strategy: Strategy;
  play: boolean;
}) {
  const reduce = useReducedMotion();
  const screens = [
    ...feedScreens(strategy.calendar),
    ...proposalScreens(strategy),
  ];
  if (screens.length === 0) return null;
  return (
    <div className="pf">
      {screens.map((screen, index) => (
        <motion.figure
          key={screen.key}
          className={screen.optional ? "pf-item optional" : "pf-item"}
          initial={play && !reduce ? { opacity: 0, y: 24 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.5,
            delay: 0.15 * index,
            ease: [0.25, 1, 0.5, 1],
          }}
        >
          <div className="pf-phone">
            <div className="pf-bar">
              <ChannelIcon channel={screen.icon} size={14} />
              <b>{screen.name}</b>
              {screen.optional ? (
                <span className="pf-tag">Optional</span>
              ) : null}
            </div>
            <div className="pf-screen">
              {/* Twice over, so the scroll loops without a seam. */}
              <div
                className="pf-scroll"
                style={{
                  animationDuration: `${Math.max(screen.entries.length, 4) * 4}s`,
                }}
              >
                {[0, 1].map((copy) =>
                  screen.entries.map((entry, at) => (
                    <div
                      key={`${copy}-${entry.id}`}
                      className="pf-post"
                      aria-hidden={copy === 1}
                    >
                      <Mockup entry={entry} overview={overview} seed={at} />
                    </div>
                  )),
                )}
              </div>
            </div>
          </div>
          <figcaption>
            {screen.optional ? (
              <>
                <b className="num">+{screen.perMonth}</b> {screen.many} if you
                add {screen.name}
              </>
            ) : (
              <>
                <b className="num">{screen.entries.length}</b>{" "}
                {screen.entries.length === 1 ? screen.one : screen.many}
              </>
            )}
          </figcaption>
        </motion.figure>
      ))}
    </div>
  );
}

const WIDTHS = [92, 78, 85, 64, 88, 70, 96, 58];

/** Grey bars standing in for text. */
function Lines({
  count,
  seed,
  big = false,
}: {
  count: number;
  seed: number;
  big?: boolean;
}) {
  return (
    <span className="mw-lines">
      {Array.from({ length: count }, (_, index) => (
        <i
          key={index}
          className={big ? "mw-line big" : "mw-line"}
          style={{
            width: `${index === count - 1 ? 45 + ((seed * 7) % 30) : WIDTHS[(seed + index) % WIDTHS.length]}%`,
          }}
        />
      ))}
    </span>
  );
}

function Placeholder({
  shape = "wide",
}: {
  shape?: "wide" | "square" | "tall";
}) {
  return (
    <span className={`mw-img ${shape}`} aria-hidden="true">
      <ImageIcon size={20} strokeWidth={1.5} />
    </span>
  );
}

function Author({
  overview,
  sponsored = false,
}: {
  overview: CmoOverview;
  sponsored?: boolean;
}) {
  return (
    <span className="mw-author">
      <BusinessMark overview={overview} size={24} />
      <span>
        <b>{businessDisplayName(overview)}</b>
        {sponsored ? <small>Sponsored</small> : null}
      </span>
    </span>
  );
}

function Actions() {
  return (
    <span className="mw-actions" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

function Mockup({
  entry,
  overview,
  seed,
}: {
  entry: Entry;
  overview: CmoOverview;
  seed: number;
}) {
  const channel = channelKey(entry.channel) ?? entry.channel;
  const format = entry.format;

  if (formatHasVideo(channel, format)) {
    return (
      <div className="mw-body">
        <Author overview={overview} />
        <span className="mw-img tall mw-video" aria-hidden="true">
          <Play size={22} strokeWidth={1.5} />
        </span>
        <Lines count={1} seed={seed} />
      </div>
    );
  }

  if (channel === "newsletter") {
    return (
      <div className="mw-body mw-mail">
        <span className="mw-mail-bar">
          <BusinessMark overview={overview} size={20} />
          <Lines count={1} seed={seed} />
        </span>
        <Lines count={1} seed={seed + 1} big />
        <Lines count={5} seed={seed + 2} />
        <span className="mw-button" />
      </div>
    );
  }

  if (channel === "seo") {
    return format === "page_fix" ? (
      <div className="mw-body mw-search">
        <span className="mw-search-box" />
        <span className="mw-result">
          <small>{hostOf(overview)}</small>
          <i className="mw-line link" style={{ width: "80%" }} />
          <Lines count={2} seed={seed} />
        </span>
        <span className="mw-result faded">
          <i className="mw-line" style={{ width: "40%" }} />
          <Lines count={2} seed={seed + 3} />
        </span>
      </div>
    ) : (
      <div className="mw-body mw-page">
        <span className="mw-browser" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <Lines count={2} seed={seed} big />
        <Placeholder />
        <Lines count={6} seed={seed + 1} />
      </div>
    );
  }

  if (channel === "google_ads" && format === "search_ad") {
    return (
      <div className="mw-body mw-search">
        <span className="mw-search-box" />
        <span className="mw-result">
          <small>Sponsored · {hostOf(overview)}</small>
          <i className="mw-line link" style={{ width: "86%" }} />
          <Lines count={2} seed={seed} />
        </span>
      </div>
    );
  }

  if (channel === "google_ads") {
    return (
      <div className="mw-body">
        <Placeholder />
        <Lines count={1} seed={seed} big />
        <span className="mw-button" />
      </div>
    );
  }

  if (channel === "meta_ads") {
    return (
      <div className="mw-body">
        <Author overview={overview} sponsored />
        <Lines count={2} seed={seed} />
        {format === "carousel_ad" ? (
          <span className="mw-carousel">
            <Placeholder shape="square" />
            <Placeholder shape="square" />
            <Placeholder shape="square" />
          </span>
        ) : (
          <Placeholder shape="square" />
        )}
        <span className="mw-cta">
          <Lines count={1} seed={seed + 2} />
          <span className="mw-button small" />
        </span>
      </div>
    );
  }

  if (channel === "instagram") {
    return (
      <div className="mw-body">
        <Author overview={overview} />
        {format === "quote_card" ? (
          <span className="mw-quote">
            <span aria-hidden="true">“</span>
            <Lines count={3} seed={seed} big />
          </span>
        ) : (
          <Placeholder shape="tall" />
        )}
        <Actions />
        <Lines count={2} seed={seed + 1} />
      </div>
    );
  }

  return (
    <div className="mw-body">
      <Author overview={overview} />
      <Lines count={format === "post" ? 4 : 2} seed={seed} />
      {format === "images" ? (
        <span className="mw-grid">
          <Placeholder shape="square" />
          <Placeholder shape="square" />
          <Placeholder shape="square" />
          <Placeholder shape="square" />
        </span>
      ) : format === "image" ? (
        <Placeholder />
      ) : format === "link" ? (
        <span className="mw-link">
          <Placeholder />
          <Lines count={1} seed={seed + 2} />
        </span>
      ) : null}
      {format === "reply" ? (
        <span className="mw-reply">
          <BusinessMark overview={overview} size={18} />
          <Lines count={2} seed={seed + 3} />
        </span>
      ) : null}
      <Actions />
    </div>
  );
}

function hostOf(overview: CmoOverview): string {
  try {
    return new URL(overview.websiteUrl).hostname.replace(/^www\./, "");
  } catch {
    return overview.businessName;
  }
}
