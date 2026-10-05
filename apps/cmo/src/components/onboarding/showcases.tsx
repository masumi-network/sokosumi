"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { motion } from "motion/react";
import type { CSSProperties, ReactNode } from "react";

import { calendarKind } from "../../lib/calendar";
import { ChannelIcon } from "../channel-icon";
import { BusinessMark, businessDisplayName } from "./flow";

type Strategy = NonNullable<CmoOverview["strategy"]>;
type Entry = Strategy["calendar"][number];

export type ShowcaseKind =
  | "x"
  | "linkedin"
  | "instagram"
  | "ad"
  | "newsletter"
  | "seo";

const ORDER: ShowcaseKind[] = [
  "x",
  "linkedin",
  "instagram",
  "ad",
  "newsletter",
  "seo",
];

function showcaseKind(
  entry: Pick<Entry, "channel" | "format">,
): ShowcaseKind | null {
  const channel = entry.channel.toLowerCase();
  const kind = calendarKind(entry);
  if (kind === "ad") return "ad";
  if (kind === "news") return "newsletter";
  if (kind === "article") return "seo";
  if (channel === "x" || channel === "twitter") return "x";
  if (channel === "linkedin") return "linkedin";
  if (channel === "instagram") return "instagram";
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

const LABELED_LINE = /^(?:subject|headline|title)\s*:\s*(.+)$/im;

/** A draft's "Subject:" or "Headline:" line, which Cuso writes for mail and ads. */
function labeled(entry: Entry): string | null {
  return LABELED_LINE.exec(entry.draft ?? "")?.[1]?.trim() ?? null;
}

function text(entry: Entry): string {
  const body = entry.draft?.replace(LABELED_LINE, "").trim();
  return body || entry.hook || entry.brief || entry.title;
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

function brand(overview: CmoOverview): CSSProperties {
  const [accent, second] = overview.brandVisual?.colors ?? [];
  return {
    "--brand": accent ?? "var(--foreground)",
    "--brand-2": second ?? accent ?? "var(--muted)",
  } as CSSProperties;
}

function when(entry: Entry): string {
  const day = new Date(`${entry.date}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  return entry.time ? `${day} · ${entry.time}` : day;
}

/**
 * The founder's accounts as they will look once Cuso runs the plan, built
 * from the real drafts. No invented likes or followers.
 */
export function Showcases({ overview }: { overview: CmoOverview }) {
  const strategy = overview.strategy as Strategy;
  const groups = showcaseEntries(strategy);
  const kinds = ORDER.filter((kind) => groups.has(kind));
  if (kinds.length === 0) {
    return (
      <p className="ob-note">Cuso shows previews once the plan has posts.</p>
    );
  }
  return (
    <div className="ob-showcases" style={brand(overview)}>
      {kinds.map((kind, index) => (
        <motion.div
          key={kind}
          className="ob-showcase"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.05 * index }}
        >
          <Showcase
            kind={kind}
            entries={groups.get(kind) ?? []}
            overview={overview}
          />
        </motion.div>
      ))}
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

function Showcase({
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
            <div key={entry.id} className="sx-post">
              <BusinessMark overview={overview} size={28} />
              <div>
                <p className="sx-meta">
                  <strong>{name}</strong> @{at} · {when(entry)}
                </p>
                <p className="sx-text">{text(entry)}</p>
              </div>
            </div>
          ))}
        </Frame>
      );
    case "linkedin":
      return (
        <Frame channel="linkedin" label="Your LinkedIn feed">
          {entries.slice(0, 2).map((entry) => (
            <div key={entry.id} className="sl-post">
              <div className="sl-head">
                <BusinessMark overview={overview} size={36} />
                <div>
                  <p className="sl-name">{name}</p>
                  <p className="sl-sub">{when(entry)}</p>
                </div>
              </div>
              <p className="sl-text">{text(entry)}</p>
              <div className="sl-card">
                <div className="sl-card-image" />
                <span>{entry.title}</span>
                <small>{host(overview.websiteUrl)}</small>
              </div>
            </div>
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
            {entries.slice(0, 9).map((entry, index) => (
              <div
                key={entry.id}
                className={`si-tile t${index % 3}`}
                title={entry.title}
              >
                <span>{entry.hook ?? entry.title}</span>
              </div>
            ))}
          </div>
        </Frame>
      );
    case "ad":
      return (
        <Frame channel={first.channel} label="Your ad">
          <div className="sa-ad">
            <div className="sl-head">
              <BusinessMark overview={overview} size={32} />
              <div>
                <p className="sl-name">{name}</p>
                <p className="sl-sub">Sponsored</p>
              </div>
            </div>
            <p className="sl-text">{text(first)}</p>
            <div className="sa-visual">
              <span>{labeled(first) ?? first.hook ?? first.title}</span>
            </div>
            <div className="sa-cta">
              <span>{host(overview.websiteUrl)}</span>
              <span className="sa-button">Learn more</span>
            </div>
          </div>
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
            <p className="sn-subject">
              {labeled(first) ?? first.hook ?? first.title}
            </p>
            <div className="sn-rule" />
            <p className="sn-body">{text(first)}</p>
          </div>
        </Frame>
      );
    case "seo":
      return (
        <Frame channel="website" label="Your article in Google">
          {entries.slice(0, 2).map((entry) => (
            <div key={entry.id} className="ss-result">
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
            </div>
          ))}
        </Frame>
      );
  }
}
