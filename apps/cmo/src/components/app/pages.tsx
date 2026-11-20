import { SiteDisclosures } from "../site-disclosures";

("use client");

import type { CmoOverview, CmoSubscriptionPlan } from "@sokosumi/core-client";
import { Loader2 } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { AGENT_NAME } from "../../lib/agent";
import type { BrandBrain } from "../../lib/brand-sections";
import {
  channelLabel,
  connectedNetworks,
  formatDay,
  SOCIAL_PROVIDERS,
  waitsForNetwork,
} from "../../lib/calendar";
import { channelInfo, SOON_CHANNELS } from "../../lib/channels";
import type { CusoMessage } from "../../lib/chat-messages";
import { cusoSubscribed } from "../../lib/cuso-subscribed";
import { strategyApproved } from "../../lib/strategy";
import { monthEntries } from "../../lib/today";
import type { View } from "../../lib/views";
import {
  type AdActions,
  AdsPanel,
  adsReturnError,
  ConnectAdsButton,
} from "../ads";
import { hostOf } from "../brand-profile";
import { ChannelIcon } from "../channel-icon";
import { LocalDay } from "../local-day";
import { BrandStep } from "../onboarding/brand-step";
import type { ConnectMeasurement } from "../onboarding/plan-tabs";
import { StartOver } from "../start-over";
import { StatusDisc, StatusText } from "../status";
import { MeasureFunnel } from "../strategy-core";
import { SubmitButton } from "../submit-button";
import { type StartTopUp, TopUpButton } from "../top-up";
import {
  type ChangePlan,
  type OpenPortal,
  SubscriptionCard,
} from "./subscription-card";
import { type SetTimeZone, TimeZoneSetting } from "./time-zone";
import { MonthBar, NetworkBars } from "./today-page";

interface PageProps {
  overview: CmoOverview;
  compose: (text: string) => void;
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="empty">
      <span className="shape" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

export function ResultsPage({
  overview,
  openUpdate,
  connectMeasurement,
  ads,
  onChange,
  openView,
}: PageProps & {
  openView: (view: View) => void;
  openUpdate: (id: string) => void;
  connectMeasurement: ConnectMeasurement;
  ads: Pick<AdActions, "loadAdCampaigns" | "setAdCampaignStatus">;
  onChange: (overview: CmoOverview) => void;
}) {
  const weekly = overview.updates.filter((update) => update.kind === "weekly");
  const { posts } = overview;
  // Pieces Cuso has written that are not Social posts yet count as drafts too.
  const writtenInPlan = (overview.strategy?.calendar ?? []).filter(
    (entry) =>
      entry.draft &&
      !entry.socialPostId &&
      entry.status !== "published" &&
      entry.status !== "skipped",
  ).length;
  const networks = connectedNetworks(overview.channels);
  const connected = networks.length > 0;
  // A written post on a network that is not connected is not a draft Cuso
  // still works on: it waits for the owner to connect that network.
  const waits = (
    (overview.approvedStrategy ?? overview.strategy)?.calendar ?? []
  ).flatMap((entry) => waitsForNetwork(entry, networks) ?? []);
  const drafts = Math.max(0, posts.draft + writtenInPlan - waits.length);
  const review = nextWeeklyReview(overview);
  const month = monthEntries(overview);
  return (
    <div className="page-body">
      <div className="grid4">
        <Kpi label="Published" value={posts.published} />
        <Kpi label="Scheduled" value={posts.scheduled} />
        {waits.length > 0 ? (
          <Kpi
            label="Waiting"
            value={waits.length}
            note={`for ${[...new Set(waits)].map(channelLabel).join(", ")}`}
          />
        ) : null}
        {drafts > 0 || waits.length === 0 ? (
          <Kpi label="Drafts" value={drafts} />
        ) : null}
        {/* Four tiles a row: Failed gives way unless something failed. */}
        {posts.failed > 0 || waits.length === 0 || drafts === 0 ? (
          <Kpi label="Failed" value={posts.failed} />
        ) : null}
      </div>
      {waits.length > 0 ? (
        <p className="cal-waits">
          <StatusDisc status="warn" decorative />
          <span className="grow">
            {waits.length === 1
              ? "1 post is written and waits"
              : `${waits.length} posts are written and wait`}{" "}
            for {[...new Set(waits)].map(channelLabel).join(" and ")}.
          </span>
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={() => openView("channels")}
          >
            Connect
          </button>
        </p>
      ) : null}
      {month.length > 0 ? (
        <section className="card results-month">
          <h3>This month</h3>
          <MonthBar entries={month} />
          <h3>By network</h3>
          <NetworkBars entries={month} />
        </section>
      ) : null}
      <section className="card">
        <h3>Your numbers</h3>
        <p className="muted">
          {AGENT_NAME} reads real visits, searches and orders from these. Where
          none of them reaches, he estimates and asks you for the number.
        </p>
        <MeasureFunnel
          sources={overview.measurement}
          onConnect={connectMeasurement}
        />
      </section>
      <AdsPanel
        overview={overview}
        actions={ads}
        onChange={onChange}
        openView={openView}
      />
      <section className="card">
        <h3>Reach and clicks</h3>
        <p className="muted">
          {connected ? (
            review ? (
              <>
                No numbers yet: your networks report reach and clicks after a
                post has been out for a while. The first ones arrive with the
                weekly report on{" "}
                <LocalDay at={review.at} serverZone={review.zone} time />.
              </>
            ) : (
              `Your networks haven't reported reach or clicks yet. ${AGENT_NAME} says so in each weekly report instead of guessing.`
            )
          ) : (
            `Reach and clicks show here once you connect an account and ${AGENT_NAME}'s posts go out. Until then there is nothing to measure.`
          )}
        </p>
        <ComingUp
          overview={overview}
          openCalendar={() => openView("calendar")}
        />
      </section>
      <section className="card">
        <h3>Weekly reports</h3>
        {weekly.length === 0 ? (
          <p className="muted">
            {review ? (
              <>
                The first weekly report arrives on{" "}
                <LocalDay at={review.at} serverZone={review.zone} time />.
              </>
            ) : (
              "The first weekly report arrives in the week after you approve the strategy."
            )}
          </p>
        ) : (
          <ul className="list">
            {weekly.map((update) => (
              <li key={update.id} className="li">
                <span className="note num">
                  {new Date(update.at).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                  })}
                </span>
                <span className="grow">{update.headline}</span>
                <button
                  type="button"
                  className="button button-secondary button-small"
                  onClick={() => openUpdate(update.id)}
                >
                  Open in chat
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const WEEK_MS = 7 * 86_400_000;

/**
 * What goes out in the next seven days: before any number exists, the work
 * that will produce the numbers is what there is to see.
 */
function ComingUp({
  overview,
  openCalendar,
  now = new Date(),
}: {
  overview: CmoOverview;
  openCalendar: () => void;
  now?: Date;
}) {
  const from = now.toISOString().slice(0, 10);
  const until = new Date(now.getTime() + WEEK_MS).toISOString().slice(0, 10);
  const coming = (
    (overview.approvedStrategy ?? overview.strategy)?.calendar ?? []
  )
    .filter(
      (entry) =>
        entry.status === "scheduled" &&
        entry.date >= from &&
        entry.date < until,
    )
    .sort((a, b) =>
      `${a.date}${a.time ?? ""}`.localeCompare(`${b.date}${b.time ?? ""}`),
    );
  if (coming.length === 0) return null;
  return (
    <>
      <span className="label">
        Going out in the next seven days: {coming.length}{" "}
        {coming.length === 1 ? "post" : "posts"}
      </span>
      <ul className="list">
        {coming.slice(0, 5).map((entry) => (
          <li key={entry.id} className="li">
            <ChannelIcon channel={entry.channel} size={16} />
            <span className="grow">{entry.title}</span>
            <span className="note num">
              {formatDay(entry.date, {
                weekday: "short",
                day: "numeric",
                month: "short",
              })}
              {entry.time ? `, ${entry.time}` : ""}
            </span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="button button-secondary button-small"
        onClick={openCalendar}
      >
        {coming.length > 5
          ? `See all ${coming.length} in your calendar`
          : "See your calendar"}
      </button>
    </>
  );
}

/** When the next weekly review runs, once the strategy is approved. */
function nextWeeklyReview(
  overview: CmoOverview,
): { at: Date | string; zone: string | null } | null {
  const review = overview.routines.find(
    (routine) => routine.key === "cmo-weekly-review",
  );
  return review?.nextRunAt && strategyApproved(overview)
    ? { at: review.nextRunAt, zone: review.timezone }
    : null;
}

/** The line under the Results title: how often, and the real next day. */
export function ResultsLead({ overview }: { overview: CmoOverview }) {
  const review = nextWeeklyReview(overview);
  return (
    <>
      Real numbers from your accounts, checked every week.
      {review ? (
        <>
          {" "}
          Next check: <LocalDay at={review.at} serverZone={review.zone} time />.
        </>
      ) : null}
    </>
  );
}

function Kpi({
  label,
  value,
  note = "posts",
}: {
  label: string;
  value: number;
  note?: string;
}) {
  return (
    <div className="kpi">
      <span className="label">{label}</span>
      <span className="v num">{value}</span>
      <span className="note">{note}</span>
    </div>
  );
}

interface BrandBrainPageProps {
  overview: CmoOverview;
  messages: CusoMessage[];
  onSave: (brain: BrandBrain) => Promise<void>;
  onAsk: (text: string) => Promise<void>;
}

/** The hiring review's Brand Brain, without the approval: edit and tell Cuso what's off. */
export function BrandBrainPage({
  overview,
  messages,
  onSave,
  onAsk,
}: BrandBrainPageProps) {
  if (!overview.brandBrain) {
    return <Empty>{AGENT_NAME} is still learning your business.</Empty>;
  }
  return (
    <div className="page-body">
      <BrandStep
        overview={overview}
        messages={messages}
        onCorrect={onAsk}
        onSave={onSave}
      />
    </div>
  );
}

type Provider = (typeof SOCIAL_PROVIDERS)[number];

/** Starts a network's connection; the provider sends the founder back to CMO. */
export type ConnectChannel = (
  provider: Provider,
) => Promise<{ url: string | null; error: string | null }>;

/** Networks where one sign-in reaches several accounts, so the pick can change. */
const PICKED_ACCOUNT: ReadonlySet<Provider> = new Set(["linkedin", "facebook"]);

const AD_PROVIDERS = [
  ["google_ads", "Google Ads"],
  ["meta_ads", "Meta ads"],
] as const;

export function ChannelsPage({
  overview,
  connect,
  connectAds,
  addMailingList,
  onChange,
  connectError = null,
  change,
  openSeo,
  connectSearchConsole,
}: PageProps & {
  connect: ConnectChannel;
  addMailingList: AddMailingList;
  onChange: (overview: CmoOverview) => void;
  connectAds: AdActions["connectAds"];
  /** Why the connection that sent the founder back did not finish. */
  connectError?: string | null;
  /** Signs in again to put another account in a connection's place. */
  change?: (socialConnectionId: string) => ReturnType<ConnectChannel>;
  /** Opens the SEO tab, where search work and Search Console live. */
  openSeo: () => void;
  connectSearchConsole: () => Promise<{
    url: string | null;
    error: string | null;
  }>;
}) {
  const [pending, setPending] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(connectError);
  useEffect(() => {
    const adsError = adsReturnError();
    if (adsError) setError(adsError);
  }, []);
  const [, startTransition] = useTransition();

  function start(provider: Provider, replaceId?: string) {
    setPending(provider);
    setError(null);
    startTransition(async () => {
      const result =
        replaceId && change ? await change(replaceId) : await connect(provider);
      if (result.url) {
        window.location.assign(result.url);
        return;
      }
      setPending(null);
      setError(
        result.error && /configured|unavailable|set up/i.test(result.error)
          ? "Connecting accounts isn't available here yet."
          : (result.error ?? "Could not start connecting. Try again."),
      );
    });
  }

  return (
    <div className="page-body">
      {error ? (
        <p className="alert" role="alert">
          {error}
        </p>
      ) : null}
      <section className="card">
        <h3>Social accounts</h3>
        <ul className="list">
          {SOCIAL_PROVIDERS.filter(
            // TikTok only where Core can connect it (it holds a Zernio key).
            (provider) => provider !== "tiktok" || overview.tiktokEnabled,
          ).map((provider) => {
            const account = overview.channels.find(
              (channel) => channel.provider.toLowerCase() === provider,
            );
            const active = account?.status.toUpperCase() === "ACTIVE";
            return (
              <li key={provider} className="crow">
                <ChannelIcon channel={provider} size={20} />
                <span className="grow">
                  <b>{channelLabel(provider)}</b>
                  <br />
                  <span className="note">
                    {account
                      ? `${account.handle ?? account.displayName ?? "Connected"}${account.personalProfile ? " · your personal profile" : ""}`
                      : "Not connected"}
                    {provider === "tiktok"
                      ? ". You confirm each video before it goes out."
                      : null}
                  </span>
                </span>
                {active ? (
                  <>
                    <StatusText>Connected</StatusText>
                    {account && change && PICKED_ACCOUNT.has(provider) ? (
                      <button
                        type="button"
                        className="button button-secondary button-small"
                        disabled={pending !== null}
                        onClick={() => start(provider, account.id)}
                      >
                        {pending === provider ? (
                          <Loader2
                            size={14}
                            className="spin"
                            aria-hidden="true"
                          />
                        ) : null}
                        Change
                      </button>
                    ) : null}
                  </>
                ) : (
                  <button
                    type="button"
                    className="button button-secondary button-small"
                    disabled={pending !== null}
                    onClick={() => start(provider)}
                  >
                    {pending === provider ? (
                      <Loader2 size={14} className="spin" aria-hidden="true" />
                    ) : null}
                    {account ? "Reconnect" : "Connect"}
                  </button>
                )}
              </li>
            );
          })}
          {SOON_CHANNELS.filter(
            ({ key }) => channelInfo(key)?.group === "social",
          ).map(({ key, name }) => (
            <li key={key} className="crow">
              <ChannelIcon channel={key} size={20} />
              <span className="grow">
                <b>{name}</b>
                <br />
                <span className="note">Not open yet.</span>
              </span>
              <span className="tag">Soon</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="card">
        <h3>Ad accounts</h3>
        <p className="muted">
          Optional. {AGENT_NAME} writes the ads; you launch each one, and they
          never spend more than your strategy's ad budget.
        </p>
        <ul className="list">
          {AD_PROVIDERS.map(([provider, label]) => (
            <li key={provider} className="crow">
              <ChannelIcon channel={provider} size={20} />
              <span className="grow">
                <b>{label}</b>
              </span>
              {overview.adProviders.includes(provider) ? (
                <StatusText>Connected</StatusText>
              ) : (
                <ConnectAdsButton
                  provider={provider}
                  from="app"
                  connectAds={connectAds}
                />
              )}
            </li>
          ))}
        </ul>
      </section>
      <section className="card">
        <h3>Newsletter</h3>
        <MailingList
          size={overview.mailingListSize}
          add={addMailingList}
          onChange={onChange}
        />
      </section>
      <section className="card">
        <h3>Google search</h3>
        <p className="muted">
          No account to connect for SEO: {AGENT_NAME} audits your site every
          week and writes page changes and articles for you to paste. Connect
          Search Console and he also sees the searches that find you.
        </p>
        <ul className="list">
          <li className="crow">
            <ChannelIcon channel="seo" size={20} />
            <span className="grow">
              <b>Google Search Console</b>
            </span>
            {overview.measurement.some(
              (source) =>
                source.provider === "google_search_console" &&
                source.status === "connected",
            ) ? (
              <StatusText>Connected</StatusText>
            ) : (
              <button
                type="button"
                className="button button-secondary button-small"
                onClick={async () => {
                  const result = await connectSearchConsole();
                  if (result.url) window.location.assign(result.url);
                  else setError(result.error ?? "Could not start connecting.");
                }}
              >
                Connect
              </button>
            )}
          </li>
        </ul>
        <div>
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={openSeo}
          >
            Open SEO
          </button>
        </div>
      </section>
      <p className="note">
        {AGENT_NAME} plans for every channel he can reach, and never posts
        outside the strategy you approved.
      </p>
    </div>
  );
}

export type AddMailingList = (
  text: string,
) => Promise<{ overview: CmoOverview | null; error: string | null }>;

interface MailingListProps {
  size: number;
  add: AddMailingList;
  onChange: (overview: CmoOverview) => void;
}

/** The addresses Cuso writes the newsletter for; the owner sends each issue. */
function MailingList({ size, add, onChange }: MailingListProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const count = new Intl.NumberFormat("en-GB").format(size);
  return (
    <>
      <p className="muted">
        {AGENT_NAME} writes each issue for the people on your list. You find it
        in your Calendar and send it yourself.
      </p>
      <div className="li">
        <span className="grow">
          <b>Send from here</b>
          <br />
          <span className="note">
            {AGENT_NAME} sends each issue to your list himself.
          </span>
        </span>
        <span className="tag">Soon</span>
      </div>
      <div className="li">
        <span className="grow">
          {size > 0 ? (
            <StatusText>
              <span className="num">{count}</span> addresses
            </StatusText>
          ) : (
            <span className="muted">No list yet</span>
          )}
        </span>
        {open ? null : (
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={() => setOpen(true)}
          >
            {size > 0 ? "Add more" : "Add your list"}
          </button>
        )}
      </div>
      {open ? (
        <form
          className="stack-sm"
          action={async () => {
            const value = text.trim();
            if (!value) return;
            setError(null);
            try {
              const result = await add(value);
              if (result.error || !result.overview) {
                setError(result.error ?? "Could not add the list.");
                return;
              }
              onChange(result.overview);
              setText("");
              setOpen(false);
            } catch {
              setError("That didn't go through. Try again.");
            }
          }}
        >
          <label className="label" htmlFor="mailing-list">
            Paste email addresses, one per line or separated by commas
          </label>
          <textarea
            id="mailing-list"
            rows={5}
            value={text}
            onChange={(event) => setText(event.target.value)}
            required
          />
          {error ? (
            <p className="note" role="alert">
              {error}
            </p>
          ) : null}
          <div className="acts">
            <SubmitButton className="button button-secondary button-small">
              Add
            </SubmitButton>
            <button
              type="button"
              className="button button-ghost button-small"
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </>
  );
}

export function SettingsPage({
  overview,
  name,
  email,
  startOver,
  mayHire = false,
  setTimeZone,
  signOut,
  topUp,
  plans,
  changePlan,
  openPortal,
  subscribe,
}: PageProps & {
  name: string;
  email: string;
  startOver: () => Promise<string | null>;
  /** The person may hire another Cuso; without it the offer is left out. */
  mayHire?: boolean;
  setTimeZone: SetTimeZone;
  signOut: () => Promise<void>;
  /** The top-up checkout, or null when this Cuso may not top up. */
  topUp: StartTopUp | null;
  /** The CMO plans; read only for a viewer who may change the plan. */
  plans: CmoSubscriptionPlan[];
  changePlan: ChangePlan;
  openPortal: OpenPortal;
  /** Starts the CMO plan checkout. */
  subscribe: StartTopUp;
}) {
  return (
    <div className="page-body">
      <SubscriptionCard
        billing={overview.billing}
        plans={plans}
        changePlan={changePlan}
        openPortal={openPortal}
        subscribe={subscribe}
      />
      <section className="card">
        <h3>Credits</h3>
        <div className="li">
          <span className="grow">
            <span className="v num">
              {Math.floor(overview.billing.availableCredits)}
            </span>{" "}
            <span className="note">credits available</span>
          </span>
          {topUp ? (
            <TopUpButton
              startTopUp={topUp}
              className="button button-secondary button-small"
            />
          ) : null}
        </div>
      </section>
      <section className="card">
        <h3>Autonomy</h3>
        <p className="muted">
          Full autopilot. You approve the strategy; {AGENT_NAME} runs everything
          inside it and tells you what he did.
        </p>
      </section>
      <section className="card">
        <h3>What {AGENT_NAME} does when</h3>
        <p className="muted">
          Everything here works from your strategy and starts once you approve
          it. The nightly learning runs from day one.
        </p>
        <TimeZoneSetting
          timeZone={overview.timeZone}
          setTimeZone={setTimeZone}
        />
        <ul className="list">
          {overview.routines.map((routine) => (
            <li key={routine.key} className="li routine">
              <span className="grow">
                <b>{routine.name}</b>
                <br />
                <span className="note">{routine.description}</span>
              </span>
              <span className="note num">
                {routine.when}
                {routine.nextRunAt &&
                !(
                  routine.key === "cmo-strategy-nudge" &&
                  strategyApproved(overview)
                ) ? (
                  <>
                    <br />
                    Next:{" "}
                    {formatRoutineRun(routine.nextRunAt, routine.timezone)}
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </section>
      {mayHire ? (
        <section className="card">
          <h3>Another website</h3>
          <p className="muted">
            Hire another {AGENT_NAME} for a different website. This one keeps
            working.
          </p>
          <a className="button button-secondary button-small" href="/?hire=1">
            Hire {AGENT_NAME} for another website
          </a>
        </section>
      ) : null}
      <section className="card">
        <h3>Account</h3>
        <div className="li">
          <span className="grow">
            {name}
            <br />
            <span className="note">{email}</span>
          </span>
          <form action={signOut}>
            <button
              type="submit"
              className="button button-secondary button-small"
            >
              Sign out
            </button>
          </form>
        </div>
      </section>
      <SiteDisclosures />
      <section className="card">
        <h3>Stop this {AGENT_NAME}</h3>
        <p className="muted">
          Starting over ends {AGENT_NAME}'s work for{" "}
          {hostOf(overview.websiteUrl)} for good: he stops and his unsent posts
          are canceled. You then hire him again from the start.
        </p>
        <StartOver
          className="button button-secondary button-small"
          startOver={startOver}
          subscribed={cusoSubscribed(overview)}
        />
      </section>
    </div>
  );
}

function formatRoutineRun(at: Date | string, timeZone: string | null): string {
  return new Date(at).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  });
}
