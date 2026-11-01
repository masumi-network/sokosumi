"use client";

import "./showcases.css";

import type { CmoOverview } from "@sokosumi/core-client";
import { motion } from "motion/react";
import type { ReactNode } from "react";

import { calendarKind } from "../lib/calendar";
import { channelKey } from "../lib/channels";
import { BusinessMark, businessDisplayName } from "./business-mark";
import { ChannelIcon } from "./channel-icon";
import { plainText } from "./draft-text";

type Strategy = NonNullable<CmoOverview["strategy"]>;
type Entry = Strategy["calendar"][number];

export type ShowcaseKind =
  | "x"
  | "linkedin"
  | "instagram"
  | "facebook"
  | "ad"
  | "google"
  | "newsletter"
  | "seo";

export const SHOWCASE_ORDER: ShowcaseKind[] = [
  "x",
  "linkedin",
  "instagram",
  "facebook",
  "ad",
  "google",
  "newsletter",
  "seo",
];

export function showcaseKind(
  entry: Pick<Entry, "channel" | "format">,
): ShowcaseKind | null {
  const channel = channelKey(entry.channel) ?? entry.channel.toLowerCase();
  if (channel === "google_ads" && entry.format !== "display_ad")
    return "google";
  const kind = calendarKind(entry);
  if (kind === "ad") return "ad";
  if (kind === "news") return "newsletter";
  if (kind === "article") return "seo";
  if (channel === "x" || channel === "twitter") return "x";
  if (channel === "linkedin") return "linkedin";
  if (channel === "instagram") return "instagram";
  if (channel === "facebook") return "facebook";
  return null;
}

/** The plan's pieces per showcase, earliest first, written drafts before ideas. */
export function showcaseEntries(
  strategy: Strategy,
): Map<ShowcaseKind, Entry[]> {
  const groups = new Map<ShowcaseKind, Entry[]>();
  const sorted = [...strategy.calendar].sort(
    (a, b) =>
      Number(Boolean(b.draft)) - Number(Boolean(a.draft)) ||
      `${a.date}${a.time ?? ""}`.localeCompare(`${b.date}${b.time ?? ""}`),
  );
  for (const entry of sorted) {
    const kind = showcaseKind(entry);
    if (kind) groups.set(kind, [...(groups.get(kind) ?? []), entry]);
  }
  return groups;
}

/** "Subject: …", also as "**Subject:** …" or "# Subject: …". */
const LABELED_LINE =
  /^[#*\s]*(?:subject(?: line)?|headline|title)\**\s*:\s*\**\s*(.+?)\**\s*$/im;

/** "Subject: Launch day" → "Launch day"; other text as it is. */
export function withoutLabel(value: string): string {
  return LABELED_LINE.exec(value)?.[1]?.trim() ?? value;
}

/** The headline a reader sees first: the draft's "Subject:" line, the hook or the title. */
function headline(entry: Entry): string {
  return withoutLabel(
    LABELED_LINE.exec(entry.draft ?? "")?.[0] ?? entry.hook ?? entry.title,
  );
}

const squash = (value: string) => value.toLowerCase().replace(/\W+/g, "");

/**
 * The body the reader sees: the labeled line and a first line that only
 * repeats the subject or title are left out, so neither shows twice.
 */
function text(entry: Entry): string {
  const heading = headline(entry);
  const lines = plainText(entry.draft?.replace(LABELED_LINE, "") ?? "")
    .split("\n")
    .filter((line, index) => index > 0 || squash(line) !== squash(heading));
  const body = lines.join("\n").trim();
  const hook = entry.hook ? withoutLabel(entry.hook) : undefined;
  const fallback = [hook, entry.brief, entry.title].find(
    (line) => line && squash(line) !== squash(heading),
  );
  return body || fallback || entry.title;
}

function handle(overview: CmoOverview): string {
  try {
    const host = new URL(overview.websiteUrl).hostname.replace(/^www\./, "");
    return host.split(".")[0] ?? host;
  } catch {
    return overview.businessName.toLowerCase().replace(/\W+/g, "");
  }
}

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function when(entry: Entry): string {
  const day = new Date(`${entry.date}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  return entry.time ? `${day} · ${entry.time}` : day;
}

function Post({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  return (
    <motion.div
      layout="position"
      className={className}
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {children}
    </motion.div>
  );
}

/** A shared link as networks show it: the site's photo, else a brand block. */
function LinkCard({
  image,
  title,
  site,
}: {
  image: string | undefined;
  title: string;
  site: string;
}) {
  return (
    <div className="sl-card">
      {image ? (
        <img className="sl-card-image" src={image} alt="" loading="lazy" />
      ) : (
        <div className="sl-card-image" />
      )}
      <span>{title}</span>
      <small>{site}</small>
    </div>
  );
}

function Frame({
  channel,
  label,
  children,
}: {
  channel: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <>
      <p className="ob-showcase-label">
        <ChannelIcon channel={channel} size={14} />
        {label}
      </p>
      <div className="ob-device">{children}</div>
    </>
  );
}

/**
 * One of the founder's accounts as it will look once Cuso runs the plan,
 * built from the real drafts, newest post first. No invented likes or
 * followers. A post slides in when it is new.
 */
export function Showcase({
  kind,
  entries,
  overview,
}: {
  kind: ShowcaseKind;
  entries: Entry[];
  overview: CmoOverview;
}) {
  const name = businessDisplayName(overview);
  const at = handle(overview);
  const first = entries[0] as Entry;
  // The site's own photos stand in for the images Cuso makes after approval.
  const images = overview.brandVisual?.images ?? [];
  const photo = (index: number) =>
    images.length ? images[index % images.length] : undefined;
  switch (kind) {
    case "x":
      return (
        <Frame channel="x" label="Your X profile">
          <div className="sx-banner" />
          <div className="sx-profile">
            <BusinessMark overview={overview} size={52} />
            <p className="sx-name">{name}</p>
            <p className="sx-handle">@{at}</p>
          </div>
          {entries.slice(0, 3).map((entry) => (
            <Post key={entry.id} className="sx-post">
              <BusinessMark overview={overview} size={28} />
              <div>
                <p className="sx-meta">
                  <strong>{name}</strong> @{at} · {when(entry)}
                </p>
                <p className="sx-text">{text(entry)}</p>
              </div>
            </Post>
          ))}
        </Frame>
      );
    case "linkedin":
      return (
        <Frame channel="linkedin" label="Your LinkedIn feed">
          {entries.slice(0, 2).map((entry, index) => (
            <Post key={entry.id} className="sl-post">
              <div className="sl-head">
                <BusinessMark overview={overview} size={36} />
                <div>
                  <p className="sl-name">{name}</p>
                  <p className="sl-sub">{when(entry)}</p>
                </div>
              </div>
              <p className="sl-text">{text(entry)}</p>
              <LinkCard
                image={photo(index)}
                title={entry.title}
                site={host(overview.websiteUrl)}
              />
            </Post>
          ))}
        </Frame>
      );
    case "facebook":
      return (
        <Frame channel="facebook" label="Your Facebook page">
          {entries.slice(0, 2).map((entry, index) => (
            <Post key={entry.id} className="sl-post">
              <div className="sl-head">
                <BusinessMark overview={overview} size={36} />
                <div>
                  <p className="sl-name">{name}</p>
                  <p className="sl-sub">{when(entry)}</p>
                </div>
              </div>
              <p className="sl-text">{text(entry)}</p>
              <LinkCard
                image={photo(index + 1)}
                title={entry.title}
                site={host(overview.websiteUrl)}
              />
            </Post>
          ))}
        </Frame>
      );
    case "instagram":
      return (
        <Frame channel="instagram" label="Your Instagram grid">
          <div className="si-head">
            <BusinessMark overview={overview} size={44} />
            <div>
              <p className="sl-name">{at}</p>
              <p className="sl-sub">{name}</p>
            </div>
          </div>
          <div className="si-grid">
            {entries.slice(0, 9).map((entry, index) => {
              // A grid never shows the same photo twice.
              const image = images[index];
              return image ? (
                <div
                  key={entry.id}
                  className="si-tile si-photo"
                  title={entry.title}
                >
                  <img src={image} alt="" loading="lazy" />
                  <span>{entry.hook ?? entry.title}</span>
                </div>
              ) : (
                <div
                  key={entry.id}
                  className={`si-tile t${index % 3}`}
                  title={entry.title}
                >
                  <span>{entry.hook ?? entry.title}</span>
                </div>
              );
            })}
          </div>
        </Frame>
      );
    case "ad":
      return (
        <Frame
          channel={first.channel}
          label={
            channelKey(first.channel) === "meta_ads"
              ? "Your ad on Facebook and Instagram"
              : "Your ad"
          }
        >
          <div className="sa-ad">
            <div className="sl-head">
              <BusinessMark overview={overview} size={32} />
              <div>
                <p className="sl-name">{name}</p>
                <p className="sl-sub">Sponsored</p>
              </div>
            </div>
            <p className="sl-text">{text(first)}</p>
            <div className={photo(0) ? "sa-visual sa-photo" : "sa-visual"}>
              {photo(0) ? <img src={photo(0)} alt="" loading="lazy" /> : null}
              <span>{headline(first)}</span>
            </div>
            <div className="sa-cta">
              <span>{host(overview.websiteUrl)}</span>
              <span className="sa-button">Learn more</span>
            </div>
          </div>
        </Frame>
      );
    case "google":
      return (
        <Frame channel="google_ads" label="Your ad on Google">
          {entries.slice(0, 2).map((entry) => (
            <Post key={entry.id} className="ss-result">
              <p className="ss-site">
                <span className="ss-sponsored">Sponsored</span>
                <span>
                  {name}
                  <small>{host(overview.websiteUrl)}</small>
                </span>
              </p>
              <p className="ss-title">{headline(entry)}</p>
              <p className="ss-snippet">{text(entry)}</p>
            </Post>
          ))}
        </Frame>
      );
    case "newsletter":
      return (
        <Frame channel="newsletter" label="Your newsletter">
          <div className="sn-mail">
            <p className="sn-from">
              <BusinessMark overview={overview} size={24} />
              <strong>{name}</strong>
            </p>
            <p className="sn-subject">{headline(first)}</p>
            <div className="sn-rule" />
            <p className="sn-body">{text(first)}</p>
          </div>
        </Frame>
      );
    case "seo":
      return (
        <Frame channel="website" label="Your article in Google">
          {entries.slice(0, 2).map((entry) => (
            <Post key={entry.id} className="ss-result">
              <p className="ss-site">
                <BusinessMark overview={overview} size={18} />
                <span>
                  {name}
                  <small>{host(overview.websiteUrl)}</small>
                </span>
              </p>
              <p className="ss-title">{entry.title}</p>
              <p className="ss-snippet">
                {entry.hook ?? entry.brief ?? text(entry)}
              </p>
            </Post>
          ))}
        </Frame>
      );
  }
}
