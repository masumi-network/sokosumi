"use client";

import "./phone-feeds.css";

import type { CmoOverview } from "@sokosumi/core-client";
import { ImageIcon, Play } from "lucide-react";

import { channelInfo, channelKey, formatHasVideo } from "../lib/channels";
import { BusinessMark, businessDisplayName } from "./business-mark";
import { ChannelIcon } from "./channel-icon";
import { plainText } from "./draft-text";

type Strategy = NonNullable<CmoOverview["strategy"]>;
type Entry = Strategy["calendar"][number];
type Media = CmoOverview["media"][number];

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
  /** The ads platform the month's ads run on; they need its account. */
  ads?: "google_ads" | "meta_ads";
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
  {
    key: "tiktok",
    name: "TikTok",
    icon: "tiktok",
    one: "TikTok",
    many: "TikToks",
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
    one: "website page",
    many: "website pages",
  },
];

function screenKey(entry: Entry): string {
  const channel = channelKey(entry.channel) ?? entry.channel;
  return channelInfo(channel)?.group === "ads" ? "ads" : channel;
}

/** An ads platform by name, so "if you add" says which one. */
function adsName(channel: string): string {
  return channelKey(channel) === "google_ads" ? "Google Ads" : "Meta ads";
}

/**
 * Each piece on every network it goes out on: a talking video planned on one
 * network also shows on each network in its `alsoOn` (before approval; after
 * it each copy is its own entry with `videoOf`).
 */
function onEveryNetwork(pieces: Entry[]): Entry[] {
  const split = new Set(pieces.flatMap((entry) => entry.videoOf ?? []));
  return pieces.flatMap((entry) =>
    entry.videoOf || split.has(entry.id)
      ? [entry]
      : [
          entry,
          ...(entry.alsoOn ?? []).map((channel) => ({
            ...entry,
            id: `${entry.id}@${channel}`,
            channel,
          })),
        ],
  );
}

/**
 * One phone for every place the month shows up, the busiest first. Ads in
 * the month are planned like every other piece; the caption says when their
 * account is missing.
 */
export function feedScreens(calendar: Entry[]): Screen[] {
  const pieces = onEveryNetwork(planPieces(calendar));
  return SCREENS.map((screen) => ({
    ...screen,
    entries: pieces.filter((entry) => screenKey(entry) === screen.key),
  }))
    .filter((screen) => screen.entries.length > 0)
    .sort((a, b) => b.entries.length - a.entries.length)
    .map((screen) => {
      if (screen.key !== "ads") return screen;
      const channel = screen.entries[0]?.channel ?? "meta_ads";
      return {
        ...screen,
        name: adsName(channel),
        icon: channelKey(channel) ?? channel,
        ads: channelKey(channel) === "google_ads" ? "google_ads" : "meta_ads",
      };
    });
}

/** A network's own name for its short videos. */
const VIDEO_NAMES: Record<string, [string, string]> = {
  instagram: ["Reel", "Reels"],
  facebook: ["Reel", "Reels"],
  youtube: ["YouTube Short", "YouTube Shorts"],
  tiktok: ["TikTok", "TikToks"],
};

/**
 * What a phone holds in the network's own words: "8 Reels · 11 posts", "26
 * YouTube Shorts". Videos count apart where the network names them.
 */
export function screenCounts(
  screen: Screen,
): { count: number; name: string }[] {
  const names = VIDEO_NAMES[screen.key];
  const videos = names
    ? screen.entries.filter((entry) =>
        formatHasVideo(entry.channel, entry.format),
      ).length
    : 0;
  const rest = screen.entries.length - videos;
  return [
    ...(videos > 0 && names
      ? [{ count: videos, name: videos === 1 ? names[0] : names[1] }]
      : []),
    ...(rest > 0
      ? [{ count: rest, name: rest === 1 ? screen.one : screen.many }]
      : []),
  ];
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
        ...(base.key === "ads" ? { name: adsName(proposal.channel) } : {}),
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
 * makes there. A piece he has made shows its real words and picture; one
 * still to come is a placeholder in that network's shape.
 */
export function PhoneFeeds({
  overview,
  strategy,
}: {
  overview: CmoOverview;
  strategy: Strategy;
}) {
  const screens = [
    ...feedScreens(strategy.calendar),
    ...proposalScreens(strategy),
  ];
  if (screens.length === 0) return null;
  return (
    <div className="pf">
      {screens.map((screen) => (
        <figure
          key={screen.key}
          className={screen.optional ? "pf-item optional" : "pf-item"}
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
                      <Mockup
                        entry={entry}
                        overview={overview}
                        seed={at}
                        media={overview.media.find(
                          (item) => item.entryId === entry.id,
                        )}
                      />
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
                {screenCounts(screen).map(({ count, name }, index) => (
                  <span key={name}>
                    {index > 0 ? " · " : null}
                    <b className="num">{count}</b> {name}
                  </span>
                ))}
                {screen.ads && !overview.adProviders.includes(screen.ads) ? (
                  <small>
                    Planned. Connect {screen.name} in Channels to launch them.
                  </small>
                ) : null}
              </>
            )}
          </figcaption>
        </figure>
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

/** The piece's own words once it is written, else grey bars. */
function Words({
  entry,
  count,
  seed,
  big = false,
}: {
  entry: Entry;
  count: number;
  seed: number;
  big?: boolean;
}) {
  const text = entry.draft ? plainText(entry.draft) : "";
  return text ? (
    <span
      className={big ? "mw-text big" : "mw-text"}
      style={{ maxHeight: `${(count + 2) * 1.35}em` }}
    >
      {text}
    </span>
  ) : (
    <Lines count={count} seed={seed} big={big} />
  );
}

function Placeholder({
  shape = "wide",
  media,
}: {
  shape?: "wide" | "square" | "tall";
  /** The picture Cuso made for the piece, once he has. */
  media?: Media;
}) {
  const picture =
    media?.slides?.[0] ?? (media?.kind === "image" ? media.url : null);
  if (picture) {
    return (
      <img className={`mw-img ${shape}`} src={picture} alt="" loading="lazy" />
    );
  }
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
  media,
}: {
  entry: Entry;
  overview: CmoOverview;
  seed: number;
  media?: Media;
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
        <Words entry={entry} count={1} seed={seed} />
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
          <Placeholder shape="tall" media={media} />
        )}
        <Actions />
        <Words entry={entry} count={2} seed={seed + 1} />
      </div>
    );
  }

  return (
    <div className="mw-body">
      <Author overview={overview} />
      <Words entry={entry} count={format === "post" ? 4 : 2} seed={seed} />
      {media && format !== "images" && format !== "link" ? (
        <Placeholder media={media} />
      ) : format === "images" ? (
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
