"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { ArrowRight, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { AGENT_NAME } from "../../lib/agent";
import {
  channelLabel,
  isSocialProvider,
  SOCIAL_PROVIDERS,
  type SocialProvider,
} from "../../lib/calendar";
import { channelInfo, channelKey } from "../../lib/channels";
import { joinNames } from "../../lib/names";
import type { AdActions } from "../ads";
import { ChannelIcon } from "../channel-icon";
import { cusoArt } from "../cuso";
import { StatusDisc } from "../status";
import { money, PACES } from "../strategy-core";
import { CusoScene } from "./cuso-scene";
import { PresenterCard } from "./presenter-card";

/** Every channel in the strategy that Cuso runs, by its key. */
function strategyChannels(overview: CmoOverview): string[] {
  return [
    ...new Set(
      (overview.strategy?.channels ?? [])
        .map((channel) => channelKey(channel.channel))
        .filter(
          (key): key is NonNullable<typeof key> =>
            key !== null && channelInfo(key)?.status === "live",
        ),
    ),
  ];
}

/** The social networks in the strategy, which Cuso can post to once connected. */
export function strategySocialChannels(
  overview: CmoOverview,
): SocialProvider[] {
  return strategyChannels(overview).filter(isSocialProvider);
}

/** SEO has nothing to connect and the newsletter is not set up while hiring. */
const isOptionalKey = (key: string) => key !== "seo" && key !== "newsletter";

/**
 * What the founder may add but need not: every channel CMO can connect that
 * the strategy's networks above do not cover. The plan's ads and the channels
 * Cuso proposed come first, with how much each would bring a month, then the
 * other social networks (TikTok where Core lets this Project connect it) and
 * both ad accounts. The newsletter is not set up while hiring.
 */
export function optionalChannels(
  overview: CmoOverview,
): { key: string; perMonth: number | null }[] {
  const planned = strategyChannels(overview);
  const calendar = overview.strategy?.calendar ?? [];
  // A channel the plan names but gives no pieces has nothing to offer here.
  const own = planned
    .filter(
      (key) =>
        !isSocialProvider(key) &&
        isOptionalKey(key) &&
        calendar.some((entry) => channelKey(entry.channel) === key),
    )
    .map((key) => ({ key, perMonth: null }));
  const proposed = (overview.strategy?.proposals ?? []).flatMap((proposal) => {
    const key = channelKey(proposal.channel);
    return key &&
      channelInfo(key)?.status === "live" &&
      !planned.includes(key) &&
      isOptionalKey(key)
      ? [{ key, perMonth: proposal.perMonth }]
      : [];
  });
  const everything = [
    // TikTok only where Core can connect it.
    ...SOCIAL_PROVIDERS.filter(
      (key) => key !== "tiktok" || overview.tiktokEnabled,
    ),
    "google_ads",
    "meta_ads",
  ]
    .filter((key) => !planned.includes(key) || !isSocialProvider(key))
    .map((key) => ({ key, perMonth: null }));
  return [...own, ...proposed, ...everything].filter(
    (channel, index, all) =>
      all.findIndex((other) => other.key === channel.key) === index,
  );
}

type Source = CmoOverview["measurement"][number];

/** Where Cuso reads the numbers, not connected yet. */
export function measurementToConnect(overview: CmoOverview): Source[] {
  return (overview.measurement ?? []).filter(
    (source) => source.status !== "connected",
  );
}

const isAds = (key: string): key is "google_ads" | "meta_ads" =>
  key === "google_ads" || key === "meta_ads";

interface LaunchStepProps {
  overview: CmoOverview;
  onConnect: (
    provider: SocialProvider | "tiktok",
  ) => Promise<{ url: string | null; error: string | null }>;
  onConnectAds: AdActions["connectAds"];
  /** Connects Google Analytics, Search Console or Shopify to Cuso. */
  onConnectMeasurement?: (
    provider: Source["provider"],
  ) => Promise<{ url: string | null; error: string | null }>;
  onSetPresenter: (photo: string) => Promise<{ error: string | null }>;
  onClearPresenter: () => Promise<{ error: string | null }>;
  /** Records the finish and opens the app. */
  onGoToday: () => void;
  /** Why a connection came back without an account, from the return address. */
  notice?: string | null;
}

/**
 * Hiring's last step, once Cuso is paid for: where he posts, and the one
 * thing he needs to start, one of the plan's networks connected. Pressing
 * Launch shows the celebration; Go to Today records the finish and opens the
 * app.
 */
export function LaunchStep({
  overview,
  onConnect,
  onConnectAds,
  onConnectMeasurement,
  onSetPresenter,
  onClearPresenter,
  onGoToday,
  notice = null,
}: LaunchStepProps) {
  const required = strategySocialChannels(overview);
  const optional = optionalChannels(overview);
  const searchOnly = strategyChannels(overview).includes("seo");
  const plan = overview.approvedStrategy ?? overview.strategy;
  const calendar = overview.strategy?.calendar ?? [];
  const connected = new Set(
    overview.channels
      .filter((channel) => channel.status.toUpperCase() === "ACTIVE")
      .map((channel) => channel.provider.toLowerCase()),
  );
  const sources = onConnectMeasurement ? measurementToConnect(overview) : [];
  const [pending, setPending] = useState<string | null>(null);
  // Undefined until the founder acts: then the return notice no longer shows.
  const [error, setError] = useState<string | null | undefined>(undefined);
  const shownError = error === undefined ? notice : error;
  const [celebrating, setCelebrating] = useState(false);
  const [, startTransition] = useTransition();
  // One of the plan's networks is enough to start; the rest can follow.
  const waiting =
    required.length > 0 && !required.some((key) => connected.has(key));
  const pieces = (key: string) =>
    calendar.filter((entry) => channelKey(entry.channel) === key).length;

  function connect(key: string) {
    setPending(key);
    setError(null);
    startTransition(async () => {
      try {
        const source = sources.find((item) => item.provider === key);
        const result = isAds(key)
          ? await onConnectAds(key, "onboarding")
          : isSocialProvider(key) || key === "tiktok"
            ? await onConnect(key)
            : source && onConnectMeasurement
              ? await onConnectMeasurement(source.provider)
              : { url: null, error: null };
        if (result.url) {
          window.location.assign(result.url);
          return;
        }
        setPending(null);
        setError(result.error);
      } catch {
        setPending(null);
        setError("Could not connect. Try again.");
      }
    });
  }

  if (celebrating) {
    const pace = PACES.find((option) => option.level === plan?.pace?.level);
    const ads = plan?.ads;
    const summary = [
      {
        term: "Pace",
        value: pace
          ? `${pace.name}, ${plan?.pace?.perWeek ?? 0} posts a week`
          : "",
      },
      {
        term: "Ad budget",
        value: ads
          ? ads.monthly > 0
            ? `${money(ads.monthly, ads.currency)} a month`
            : "No ads"
          : "",
      },
      {
        term: "Posting to",
        value: joinNames(
          required.filter((key) => connected.has(key)).map(channelLabel),
        ),
      },
    ].filter((row) => row.value);
    return (
      <section className="ob-launch ob-launch-done">
        <div className="ob-celebration-panel">
          <div className="card ob-celebration">
            <img
              src={cusoArt("thumbs-up")}
              alt={`${AGENT_NAME} giving a thumbs up`}
              width={320}
              height={320}
            />
          </div>
        </div>
        <div className="ob-celebration-copy">
          <h1 className="ob-h1">{AGENT_NAME} is on it.</h1>
          <p className="muted">
            {AGENT_NAME} makes your month now and posts on your strategy's
            schedule. Pause or change any post from the calendar.
          </p>
          {summary.length > 0 ? (
            <dl className="ob-summary">
              {summary.map((row) => (
                <div key={row.term}>
                  <dt>{row.term}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          <button type="button" className="button ob-wide" onClick={onGoToday}>
            Go to Today
            <ArrowRight size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="button button-ghost button-small"
            onClick={() => setCelebrating(false)}
          >
            Change settings
          </button>
        </div>
      </section>
    );
  }

  const rows = [...required, ...(searchOnly ? ["seo"] : [])];
  // Ads and channels Cuso proposed: add them now or later.
  const later = optional.filter(({ key }) =>
    isAds(key) ? !overview.adProviders.includes(key) : !connected.has(key),
  );
  // The selfie offer is for a month with talking videos in it.
  const talkingVideos = calendar.some(
    (entry) => entry.format === "talking_video",
  );
  // Only a social network of the plan needs connecting before Launch.
  const accounts = required.length > 0;

  return (
    <section className="ob-launch">
      <div className="ob-lead">
        <CusoScene scene="launch" />
        <h1 className="ob-h1">
          {accounts ? "One thing, then I start." : "Ready when you are."}
        </h1>
        <p className="muted">
          {accounts
            ? "I'm making your month now. Connect where I post."
            : "I'm making your month now."}
        </p>
      </div>

      {rows.length > 0 ? (
        <div className="ob-networks-panel">
          <ul className="card ob-networks">
            {rows.map((key) => {
              const done = connected.has(key);
              const account = overview.channels.find(
                (channel) => channel.provider.toLowerCase() === key,
              );
              return (
                <li key={key} className="ob-network">
                  <ChannelIcon channel={key} size={22} />
                  <div className="ob-network-text">
                    <p className="ob-network-name">{channelLabel(key)}</p>
                    <p className="ob-small muted">
                      {key === "seo"
                        ? "Page fixes and articles you paste into your site."
                        : `${pieces(key)} of ${calendar.length} posts go here`}
                    </p>
                  </div>
                  {key === "seo" ? (
                    <span className="ob-small muted">Nothing to connect</span>
                  ) : done ? (
                    <span className="ob-connected">
                      <StatusDisc status="ok" />
                      {account?.handle ? `@${account.handle}` : "Connected"}
                    </span>
                  ) : (
                    <>
                      {waiting && required.length === 1 ? (
                        <span className="ob-small muted">Needed to start</span>
                      ) : null}
                      <button
                        type="button"
                        className="button button-secondary"
                        disabled={pending !== null}
                        onClick={() => connect(key)}
                      >
                        {pending === key ? (
                          <Loader2
                            size={14}
                            className="spin"
                            aria-hidden="true"
                          />
                        ) : null}
                        Connect
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {talkingVideos ? (
        <PresenterCard
          initiallySet={overview.presenterSet}
          onSet={onSetPresenter}
          onClear={onClearPresenter}
        />
      ) : null}

      {later.length > 0 || sources.length > 0 ? (
        <div className="ob-later">
          <p className="ob-small muted">
            Add later, here or on the Channels page
          </p>
          <div className="ob-later-chips">
            {later.map(({ key, perMonth }) => {
              // What connecting it adds: the plan's own pieces, or Cuso's proposal.
              const gain = perMonth ?? pieces(key);
              const noun =
                channelInfo(key)?.group === "ads"
                  ? gain === 1
                    ? "ad"
                    : "ads"
                  : key === "youtube"
                    ? gain === 1
                      ? "video"
                      : "videos"
                    : gain === 1
                      ? "post"
                      : "posts";
              return (
                <button
                  key={key}
                  type="button"
                  className="button button-secondary button-small"
                  disabled={pending !== null}
                  onClick={() => connect(key)}
                >
                  {channelLabel(key)}
                  {gain > 0 ? `, +${gain} ${noun}` : ""}
                </button>
              );
            })}
            {sources.map((source) => (
              <button
                key={source.provider}
                type="button"
                className="button button-secondary button-small"
                disabled={pending !== null}
                onClick={() => connect(source.provider)}
              >
                {source.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {shownError ? (
        <p className="alert" role="alert">
          {/configured|unavailable|set up/i.test(shownError)
            ? "Connecting accounts isn't available here yet."
            : shownError}
        </p>
      ) : null}

      <button
        type="button"
        className="button ob-wide"
        disabled={waiting}
        onClick={() => setCelebrating(true)}
      >
        Launch {AGENT_NAME}
        <ArrowRight size={16} aria-hidden="true" />
      </button>
      <p className="ob-small muted">
        {waiting
          ? `Connect ${joinNames(required.map(channelLabel), "or")} to launch.`
          : `${AGENT_NAME} only does what your approved strategy says, and you can disconnect any time.`}
      </p>
    </section>
  );
}
