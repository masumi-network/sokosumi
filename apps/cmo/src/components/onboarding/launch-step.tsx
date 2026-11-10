"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { ArrowRight, Loader2 } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { AGENT_NAME } from "../../lib/agent";
import {
  channelLabel,
  formatDay,
  isSocialProvider,
  type SocialProvider,
} from "../../lib/calendar";
import { channelInfo, channelKey } from "../../lib/channels";
import {
  listenForConnectDone,
  openConnectWindow,
} from "../../lib/connect-window";
import { joinNames } from "../../lib/names";
import { type AdActions, adsResultMessage } from "../ads";
import { ChannelIcon } from "../channel-icon";
import { CusoAvatar } from "../cuso";
import { CusoClip } from "../cuso-clip";
import { StatusDisc } from "../status";
import { money, PACES } from "../strategy-core";

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
  return [...own, ...proposed].filter(
    (channel, index, all) =>
      all.findIndex((other) => other.key === channel.key) === index,
  );
}

const isAds = (key: string): key is "google_ads" | "meta_ads" =>
  key === "google_ads" || key === "meta_ads";

/** How often Launch checks whether the founder closed the connect window. */
const POPUP_CHECK_MS = 500;
const CONNECT_FAILED = "That connection didn't finish. Try again.";
/** One function for every render, so the done listener is not re-made. */
const NO_RETURN = async () => {};

interface LaunchStepProps {
  overview: CmoOverview;
  onConnect: (
    provider: SocialProvider,
    from: "onboarding" | "popup",
  ) => Promise<{ url: string | null; error: string | null }>;
  onConnectAds: AdActions["connectAds"];
  /** Polls the overview at once, when a connect window finishes or closes. */
  onReturn?: () => Promise<void>;
  /** Runs before the celebration shows. */
  onLaunch: () => Promise<void>;
  /** Records the finish and opens the app. */
  onGoToday: () => void;
  /** Why a connection came back without an account, from the return address. */
  notice?: string | null;
  /** Launch was pressed, or taken back with Change settings. */
  onCelebrate?: (celebrating: boolean) => void;
}

/**
 * The next post still to come on a connected network, as "Tue 6 Oct, 09:00";
 * empty when none. Calendar days and times are the founder's local ones.
 */
export function firstPost(
  calendar: { date: string; time?: string; channel: string }[],
  connected: ReadonlySet<string>,
  now = new Date(),
): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const clock = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const first = calendar
    .filter(
      (entry) =>
        connected.has(channelKey(entry.channel) ?? "") &&
        (entry.date > today ||
          (entry.date === today && (entry.time ?? clock) >= clock)),
    )
    .map((entry) => `${entry.date} ${entry.time ?? ""}`.trim())
    .sort()[0];
  if (!first) return "";
  const [date = "", time] = first.split(" ");
  const day = formatDay(date, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  return time ? `${day}, ${time}` : day;
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
  onReturn = NO_RETURN,
  onLaunch,
  onGoToday,
  notice = null,
  onCelebrate,
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
  const [celebrating, setCelebratingState] = useState(false);
  const setCelebrating = (on: boolean) => {
    setCelebratingState(on);
    onCelebrate?.(on);
  };
  const [, startTransition] = useTransition();
  const [launching, startLaunching] = useTransition();
  // One of the plan's networks is enough to start; the rest can follow.
  const waiting =
    required.length > 0 && !required.some((key) => connected.has(key));
  const pieces = (key: string) =>
    calendar.filter((entry) => channelKey(entry.channel) === key).length;

  // Closed without a word (the founder gave up, or the window lost us): check.
  const popupCheck = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearInterval(popupCheck.current), []);
  // A connect window says how it ended; Launch polls at once, no reload.
  useEffect(
    () =>
      listenForConnectDone((result) => {
        window.clearInterval(popupCheck.current);
        setPending(null);
        setError(
          result === "failed"
            ? CONNECT_FAILED
            : result === "none"
              ? adsResultMessage("none")
              : null,
        );
        void onReturn();
      }),
    [onReturn],
  );
  function watch(popup: Window) {
    window.clearInterval(popupCheck.current);
    popupCheck.current = window.setInterval(() => {
      if (!popup.closed) return;
      window.clearInterval(popupCheck.current);
      setPending(null);
      void onReturn();
    }, POPUP_CHECK_MS);
  }

  function connect(key: string) {
    setPending(key);
    setError(null);
    // Opened in the click, before any wait, so a popup blocker lets it
    // through. Blocked, Connect leaves the page as it always did.
    const popup = openConnectWindow();
    const from = popup ? "popup" : "onboarding";
    startTransition(async () => {
      try {
        const result = isAds(key)
          ? await onConnectAds(key, from)
          : isSocialProvider(key)
            ? await onConnect(key, from)
            : { url: null, error: null };
        if (!result.url) {
          popup?.close();
          setPending(null);
          setError(result.error);
          return;
        }
        if (!popup) {
          window.location.assign(result.url);
          return;
        }
        popup.location.href = result.url;
        watch(popup);
      } catch {
        popup?.close();
        setPending(null);
        setError("Could not connect. Try again.");
      }
    });
  }

  if (celebrating) {
    const pace = PACES.find((option) => option.level === plan?.pace?.level);
    const ads = plan?.ads;
    const month = (plan?.calendar ?? []).filter(
      (entry) => entry.status !== "skipped",
    );
    const total = overview.production.total || month.length;
    // What is done, then what still runs.
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
      {
        term: "This month",
        value: total > 0 ? `${total} ${total === 1 ? "piece" : "pieces"}` : "",
      },
      { term: "First post", value: firstPost(month, connected) },
    ].filter((row) => row.value);
    return (
      <section className="ob-launch ob-launch-done">
        <div className="panel ob-celebration-panel">
          <div className="card ob-celebration">
            <CusoClip
              src="/cuso/celebration.jpg"
              alt={`${AGENT_NAME} celebrating next to a toy rocket`}
              width={320}
              height={320}
            />
          </div>
        </div>
        <div className="ob-celebration-copy">
          <p className="muted">
            {AGENT_NAME} makes your month now and posts on your plan's schedule.
            Pause or change any piece from the calendar.
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
          <p className="ob-small muted">
            Still running: {AGENT_NAME} is making your month, piece by piece.
            Watch them land on Today.
          </p>
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
  // Only a social network of the plan needs connecting before Launch.
  const accounts = required.length > 0;

  return (
    <section className="ob-launch">
      <CusoAvatar pose="done" size={96} />
      <p className="muted">
        {accounts
          ? "Your plan is approved. Connect where I post."
          : "Your plan is approved."}
      </p>

      {rows.length > 0 ? (
        <div className="panel ob-networks-panel">
          <ul className="card card-focus ob-networks">
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
                        : `${pieces(key)} of ${calendar.length} pieces go here`}
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

      {later.length > 0 ? (
        <div className="ob-later">
          <p className="ob-small muted">Add later</p>
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
      <p className="ob-small muted">
        {waiting
          ? `Connect ${joinNames(required.map(channelLabel), "or")} to launch.`
          : `${AGENT_NAME} only does what your approved plan says, and you can disconnect any time.`}
      </p>
    </section>
  );
}
