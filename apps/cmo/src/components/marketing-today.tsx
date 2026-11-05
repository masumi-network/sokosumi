import type { BrandBrain } from "../lib/brand-sections";
import { ChannelIcon } from "./channel-icon";

type Today = NonNullable<BrandBrain["marketingToday"]>;

const ADS: Record<NonNullable<Today["ads"]>["status"], string> = {
  running: "Running ads",
  none_found: "No ads found",
  unknown: "Not known",
};

/** "Instagram" → "instagram", the key the channel icons use. */
function iconKey(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "").replace("twitter", "x");
}

type Channel = NonNullable<Today["channels"]>[number];

function cadence(channel: Channel): string {
  if (channel.postsPerMonth === undefined) return "Cadence not visible";
  if (channel.postsPerMonth === 0) return "No posts in the last month";
  return `${channel.postsPerMonth} ${channel.postsPerMonth === 1 ? "post" : "posts"} a month`;
}

/**
 * Where the marketing stands before Cuso: each channel's audience, pace and
 * content, the site and the ads. Estimates say so; the strategy shows its
 * plan against this.
 */
export function MarketingToday({ today }: { today: Today }) {
  const channels = today.channels ?? [];
  return (
    <div className="mt">
      <p className="bb-big">{today.summary}</p>
      {channels.length > 0 ? (
        <ul className="mt-rows">
          {channels.map((channel) => (
            <li key={channel.name} className="mt-row">
              <span className="mt-name">
                <ChannelIcon channel={iconKey(channel.name)} size={18} />
                {channel.url ? (
                  <a href={channel.url} target="_blank" rel="noreferrer">
                    {channel.name}
                  </a>
                ) : (
                  channel.name
                )}
              </span>
              <span className="mt-stat num">
                {channel.followers
                  ? `${channel.followers} followers`
                  : "Followers not visible"}
              </span>
              <span className="mt-stat">
                {cadence(channel)}
                {channel.lastPost ? (
                  <span className="note"> · last {channel.lastPost}</span>
                ) : null}
              </span>
              <span className="mt-what">
                {[...(channel.formats ?? []), ...(channel.themes ?? [])].join(
                  " · ",
                )}
              </span>
              {channel.basis !== "measured" ? (
                <span className="mt-basis">
                  {channel.basis === "estimated" ? "Estimate" : "Not visible"}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {today.website || today.ads ? (
        <dl className="mt-facts">
          {today.website?.blog ? (
            <>
              <dt>Blog</dt>
              <dd>{today.website.blog}</dd>
            </>
          ) : null}
          {today.website?.newsletter !== undefined ? (
            <>
              <dt>Newsletter</dt>
              <dd>
                {today.website.newsletter
                  ? "Signup on the site"
                  : "No signup found"}
              </dd>
            </>
          ) : null}
          {today.ads ? (
            <>
              <dt>Ads</dt>
              <dd>
                {ADS[today.ads.status]}
                {today.ads.note ? (
                  <span className="note"> · {today.ads.note}</span>
                ) : null}
              </dd>
            </>
          ) : null}
        </dl>
      ) : null}
      {(today.website?.notes ?? []).length > 0 ? (
        <ul className="mt-notes">
          {(today.website?.notes ?? []).map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
