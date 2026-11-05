"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { ArrowRight, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";

import {
  channelLabel,
  isSocialProvider,
  type SocialProvider,
} from "../../lib/calendar";
import { channelInfo, channelKey } from "../../lib/channels";
import { joinNames } from "../../lib/names";
import type { AdActions } from "../ads";
import { ChannelIcon } from "../channel-icon";
import { AGENT_NAME, CusoAvatar } from "../cuso";
import { StatusDisc } from "../status";
import { money, PACES } from "../strategy-core";

/** Every channel in the strategy that Cuso runs, by its key. */
export function strategyChannels(overview: CmoOverview): string[] {
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

/** Whether the plan uses a channel the founder sets up: social, ads, newsletter. */
export function needsAccounts(overview: CmoOverview): boolean {
  return strategyChannels(overview).some((key) => key !== "seo");
}

/** The social networks in the strategy, which Cuso can post to once connected. */
export function strategySocialChannels(
  overview: CmoOverview,
): SocialProvider[] {
  return strategyChannels(overview).filter(isSocialProvider);
}

/**
 * What the founder may add but need not: the plan's ads and the channels
 * Cuso proposed adding, with how much each would bring a month. The
 * newsletter is not set up while hiring.
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
        key !== "seo" &&
        key !== "newsletter" &&
        calendar.some((entry) => channelKey(entry.channel) === key),
    )
    .map((key) => ({ key, perMonth: null }));
  const proposed = (overview.strategy?.proposals ?? []).flatMap((proposal) => {
    const key = channelKey(proposal.channel);
    return key &&
      channelInfo(key)?.status === "live" &&
      !planned.includes(key) &&
      key !== "seo" &&
      key !== "newsletter"
      ? [{ key, perMonth: proposal.perMonth }]
      : [];
  });
  return [...own, ...proposed].filter(
    (channel, index, all) =>
      all.findIndex((other) => other.key === channel.key) === index,
  );
}

const isAds = (key: string): key is "google_ads" | "meta_ads" =>
  key === "google_ads" || key === "meta_ads";

interface LaunchStepProps {
  overview: CmoOverview;
  onConnect: (
    provider: SocialProvider,
  ) => Promise<{ url: string | null; error: string | null }>;
  onConnectAds: AdActions["connectAds"];
  /** Runs before the celebration shows. */
  onLaunch: () => Promise<void>;
  /** Records the finish and opens the app. */
  onGoToday: () => void;
  /** Why a connection came back without an account, from the return address. */
  notice?: string | null;
}

/**
 * Where Cuso posts, and the one thing he needs to start: one of the plan's
 * networks connected. Pressing Launch records it and shows the celebration;
 * Go to Today opens the app.
 */
export function LaunchStep({
  overview,
  onConnect,
  onConnectAds,
  onLaunch,
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
  const [pending, setPending] = useState<string | null>(null);
  // Undefined until the founder acts: then the return notice no longer shows.
  const [error, setError] = useState<string | null | undefined>(undefined);
  const shownError = error === undefined ? notice : error;
  const [celebrating, setCelebrating] = useState(false);
  const [, startTransition] = useTransition();
  const [launching, startLaunching] = useTransition();
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
        const result = isAds(key)
          ? await onConnectAds(key, "onboarding")
          : isSocialProvider(key)
            ? await onConnect(key)
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
          ? `${pace.name}, ${plan?.pace?.perWeek ?? 0} pieces a week`
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
        <div className="panel">
          <div className="card ob-celebration">
            <img
              src="/cuso/celebration.jpg"
              alt={`${AGENT_NAME} celebrating next to a toy rocket`}
              width={320}
              height={320}
            />
          </div>
        </div>
        <h1 className="ob-h1">{AGENT_NAME} is on it.</h1>
        <p className="ob-muted">
          Your first posts land in your calendar. Nothing posts until you
          approve it.
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
      </section>
    );
  }

  const rows = [...required, ...(searchOnly ? ["seo"] : [])];
  // Ads and channels Cuso proposed: add them now or later.
  const later = optional.filter(({ key }) =>
    isAds(key) ? !overview.adProviders.includes(key) : !connected.has(key),
  );
  const accounts = needsAccounts(overview);

  return (
    <section className="ob-launch">
      <CusoAvatar pose="done" size={96} />
      <h1 className="ob-h1">
        {accounts ? "One thing, then I start." : "Ready when you are."}
      </h1>
      <p className="ob-muted">
        {accounts
          ? "Your plan is approved. Connect where I post."
          : "Your plan is approved. Nothing to connect."}
      </p>

      {rows.length > 0 ? (
        <div className="panel ob-networks-panel">
          <ul className="card ob-focus ob-networks">
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
                    <p className="ob-small ob-muted">
                      {key === "seo"
                        ? "Page fixes and articles you paste into your site."
                        : `${pieces(key)} of ${calendar.length} pieces go here`}
                    </p>
                  </div>
                  {key === "seo" ? (
                    <span className="ob-small ob-muted">
                      Nothing to connect
                    </span>
                  ) : done ? (
                    <span className="ob-connected">
                      <StatusDisc status="ok" />
                      {account?.handle ? `@${account.handle}` : "Connected"}
                    </span>
                  ) : (
                    <>
                      {waiting && required.length === 1 ? (
                        <span className="ob-small ob-muted">
                          Needed to start
                        </span>
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

      {later.length > 0 ? (
        <div className="ob-later">
          <p className="ob-small ob-muted">Add later</p>
          <div className="ob-later-chips">
            {later.map(({ key, perMonth }) => (
              <button
                key={key}
                type="button"
                className="button button-secondary button-small"
                disabled={pending !== null}
                title={
                  perMonth === null ? undefined : `Adds ${perMonth} a month`
                }
                onClick={() => connect(key)}
              >
                {channelLabel(key)}
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
        disabled={waiting || launching}
        onClick={() =>
          startLaunching(async () => {
            try {
              await onLaunch();
              setCelebrating(true);
            } catch {
              setError("Could not launch. Try again.");
            }
          })
        }
      >
        {launching ? "Launching…" : `Launch ${AGENT_NAME}`}
        {launching ? null : <ArrowRight size={16} aria-hidden="true" />}
      </button>
      <p className="ob-small ob-muted">
        {waiting
          ? `Connect ${joinNames(required.map(channelLabel), "or")} to launch.`
          : `${AGENT_NAME} only does what your approved plan says, and you can disconnect any time.`}
      </p>
    </section>
  );
}
