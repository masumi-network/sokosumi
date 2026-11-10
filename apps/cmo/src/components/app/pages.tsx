"use client";

import type { CmoOverview } from "@sokosumi/core-client";

import { Loader2 } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { AGENT_NAME } from "../../lib/agent";
import type { BrandBrain } from "../../lib/brand-sections";
import { channelLabel, SOCIAL_PROVIDERS } from "../../lib/calendar";
import type { CusoMessage } from "../../lib/chat-messages";
import { strategyApproved } from "../../lib/strategy";
import {
  type AdActions,
  AdsPanel,
  adsReturnError,
  ConnectAdsButton,
} from "../ads";
import { ChannelIcon } from "../channel-icon";
import { BrandStep } from "../onboarding/brand-step";
import type { ConnectMeasurement } from "../onboarding/plan-tabs";
import { StartOver } from "../start-over";
import { StatusText } from "../status";
import { MeasureFunnel } from "../strategy-core";
import { SubmitButton } from "../submit-button";

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
}: PageProps & {
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
  const connected = overview.channels.some(
    (channel) => channel.status.toUpperCase() === "ACTIVE",
  );
  // A source the plan reads that is not connected is waiting on the owner.
  const measurementNeeded = overview.measurement.some(
    (source) => source.status !== "connected",
  );
  return (
    <div className="page-body">
      <div className="grid4">
        <Kpi label="Published" value={posts.published} />
        <Kpi label="Scheduled" value={posts.scheduled} />
        <Kpi label="Drafts" value={posts.draft + writtenInPlan} />
        <Kpi label="Failed" value={posts.failed} />
      </div>
      <section className={measurementNeeded ? "card card-focus" : "card"}>
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
      <AdsPanel overview={overview} actions={ads} onChange={onChange} />
      <section className="card">
        <h3>Reach and clicks</h3>
        <p className="muted">
          {connected
            ? `Your networks haven't reported reach or clicks yet, so there is nothing to chart. ${AGENT_NAME} says so in each weekly report instead of guessing.`
            : `Reach and clicks show here once you connect an account and ${AGENT_NAME}'s posts go out. Until then there is nothing to measure.`}
        </p>
      </section>
      <section className="card">
        <h3>Weekly reports</h3>
        {weekly.length === 0 ? (
          <p className="muted">
            The first weekly report arrives on Monday after the strategy is
            approved.
          </p>
        ) : (
          <ul className="list">
            {weekly.map((update) => (
              <li key={update.id} className="li">
                <span className="tag">
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

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="kpi">
      <span className="label">{label}</span>
      <span className="v num">{value}</span>
      <span className="note">posts</span>
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

const COMING_SOON = [["Website / SEO", "Articles"]] as const;

const AD_PROVIDERS = [
  ["google_ads", "Google Ads"],
  ["meta_ads", "Meta ads"],
] as const;

export function ChannelsPage({
  overview,
  connect,
  connectAds,
  openNewsletter,
  addMailingList,
  onChange,
  connectFailed = false,
}: PageProps & {
  connect: ConnectChannel;
  addMailingList: AddMailingList;
  onChange: (overview: CmoOverview) => void;
  connectAds: AdActions["connectAds"];
  openNewsletter: () => void;
  connectFailed?: boolean;
}) {
  const [pending, setPending] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(
    connectFailed ? "That connection didn't finish. Try again." : null,
  );
  useEffect(() => {
    const adsError = adsReturnError();
    if (adsError) setError(adsError);
  }, []);
  const [, startTransition] = useTransition();

  function start(provider: Provider) {
    setPending(provider);
    setError(null);
    startTransition(async () => {
      const result = await connect(provider);
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

  // No connected network means Cuso cannot publish: the owner's move.
  const noNetwork = !overview.channels.some(
    (channel) => channel.status.toUpperCase() === "ACTIVE",
  );
  return (
    <div className="page-body">
      {error ? (
        <p className="alert" role="alert">
          {error}
        </p>
      ) : null}
      <section className={noNetwork ? "card card-focus" : "card"}>
        <h3>Social accounts</h3>
        <ul className="list">
          {SOCIAL_PROVIDERS.map((provider) => {
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
                      ? (account.handle ?? account.displayName ?? "Connected")
                      : "Not connected"}
                  </span>
                </span>
                {active ? (
                  <StatusText>Connected</StatusText>
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
        </ul>
      </section>
      <section className="card">
        <h3>Ad accounts</h3>
        <p className="muted">
          Optional. {AGENT_NAME} writes the ads; you launch each one, and they
          never spend more than your plan's ad budget.
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
        <div className="crow">
          <h3 className="grow">Newsletter</h3>
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={openNewsletter}
          >
            Open Newsletter
          </button>
        </div>
        <MailingList
          size={overview.mailingListSize}
          add={addMailingList}
          onChange={onChange}
        />
      </section>
      <section className="card">
        <h3>Coming soon</h3>
        <ul className="list">
          {COMING_SOON.map(([label, kind]) => (
            <li key={label} className="crow">
              <span className="grow">
                <b>{label}</b>
                <br />
                <span className="note">{kind}</span>
              </span>
              <span className="muted">Not yet</span>
            </li>
          ))}
        </ul>
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

/** The addresses Cuso writes the newsletter for. Adding them here only adds them to Contacts. */
function MailingList({ size, add, onChange }: MailingListProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const count = new Intl.NumberFormat("en-GB").format(size);
  return (
    <>
      <p className="muted">
        {AGENT_NAME} writes each issue for the people on your list. Open
        Newsletter to choose subscribers and confirm consent.
      </p>
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
  signOut,
}: PageProps & {
  name: string;
  email: string;
  startOver: () => Promise<string | null>;
  signOut: () => Promise<void>;
}) {
  return (
    <div className="page-body">
      <section className="card">
        <h3>Credits</h3>
        <div className="li">
          <span className="grow">
            <span className="v num">
              {Math.floor(overview.billing.availableCredits)}
            </span>{" "}
            <span className="note">credits available</span>
          </span>
          <a
            className="button button-secondary button-small"
            href={overview.subscribeUrl}
            target="_blank"
            rel="noreferrer"
          >
            Top up
          </a>
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
          Every routine works from your strategy and starts once you approve it.
          Dreaming runs every night from the start.
        </p>
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
      <section className="card">
        <h3>Another website</h3>
        <p className="muted">
          Hire {AGENT_NAME} again for a different website.
        </p>
        <StartOver
          className="button button-secondary button-small"
          startOver={startOver}
        />
      </section>
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
