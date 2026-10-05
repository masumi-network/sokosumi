import type { CmoOverview } from "@sokosumi/core-client";

import { formatMonth } from "./cards";
import { ExpandableText } from "./expandable-text";
import { CalendarLegend, MonthCalendar } from "./month-calendar";

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

export function StrategyPage({ overview }: PageProps) {
  const strategy = overview.strategy;
  if (!strategy) {
    return <Empty>Cuso is still writing the strategy.</Empty>;
  }
  return (
    <div className="page-body">
      <p>{strategy.summary}</p>
      <div className="grid2">
        <section className="panel">
          <h3>Goal</h3>
          <ul className="plain">
            {strategy.goals.map((goal) => (
              <li key={goal}>{goal}</li>
            ))}
          </ul>
        </section>
        <section className="panel">
          <h3>Positioning</h3>
          <p>{strategy.positioning ?? "Not set yet."}</p>
        </section>
        <section className="panel">
          <h3>Audience</h3>
          <p>{strategy.audience ?? "Not set yet."}</p>
        </section>
        <section className="panel">
          <h3>Channels</h3>
          <ul className="plain">
            {strategy.channels.map((channel) => (
              <li key={channel.channel}>
                <b>{channel.channel}</b>{" "}
                <span className="note">{channel.cadence}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <section className="panel">
        <h3>{formatMonth(strategy.month)}</h3>
        <CalendarLegend />
        <div className="cal-scroll">
          <MonthCalendar
            strategy={strategy}
            big
            connected={overview.channels
              .filter((channel) => channel.status === "ACTIVE")
              .map((channel) => channel.provider)}
          />
        </div>
      </section>
      <p className="note">
        Everything here changes by talking to Cuso. You approve this page once;
        Cuso runs it from then on.
      </p>
    </div>
  );
}

export function ResultsPage({
  overview,
  openUpdate,
}: PageProps & { openUpdate: (id: string) => void }) {
  const weekly = overview.updates.filter((update) => update.kind === "weekly");
  const { posts } = overview;
  return (
    <div className="page-body">
      <div className="grid4">
        <Kpi label="Published" value={posts.published} />
        <Kpi label="Scheduled" value={posts.scheduled} />
        <Kpi label="Drafts" value={posts.draft} />
        <Kpi label="Failed" value={posts.failed} />
      </div>
      <section className="panel">
        <h3>Reach and clicks</h3>
        <p className="muted">
          The connected providers report no reach or click numbers to Sokosumi
          yet, so there is nothing to chart. Cuso says the same in each weekly
          report instead of guessing.
        </p>
      </section>
      <section className="panel">
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
                  className="button button-ghost button-small"
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

export function BrandBrainPage({ overview }: PageProps) {
  const brain = overview.brandBrain;
  if (!brain) {
    return <Empty>Cuso is still learning your business.</Empty>;
  }
  return (
    <div className="page-body">
      <div className="grid2">
        <section className="panel">
          <h3>Business</h3>
          <p>
            <ExpandableText text={brain.summary} />
          </p>
        </section>
        <section className="panel">
          <h3>Voice</h3>
          <p>{brain.voice.tone}</p>
          {brain.voice.examples.map((line) => (
            <p key={line} className="quote">
              {line}
            </p>
          ))}
        </section>
        <section className="panel">
          <h3>Products</h3>
          <Lines items={brain.products} />
        </section>
        <section className="panel">
          <h3>Audience</h3>
          <Lines items={brain.audience} />
        </section>
        <section className="panel">
          <h3>Competitors</h3>
          <Lines items={brain.competitors.map((c) => c.name)} />
        </section>
        <section className="panel">
          <h3>Always / never</h3>
          <Lines
            items={[
              ...brain.voice.do.map((line) => `Always: ${line}`),
              ...brain.voice.dont.map((line) => `Never: ${line}`),
            ]}
          />
        </section>
      </div>
    </div>
  );
}

function Lines({ items }: { items: string[] }) {
  if (items.length === 0) return <p className="muted">Nothing yet.</p>;
  return (
    <ul className="plain">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

/** What Sokosumi's Project Social can connect today. */
const SOCIAL_PROVIDERS = [
  ["x", "X"],
  ["linkedin", "LinkedIn"],
  ["instagram", "Instagram"],
  ["facebook", "Facebook"],
  ["tiktok", "TikTok"],
  ["youtube", "YouTube"],
] as const;

const COMING_SOON = [
  ["Meta ads", "Ads"],
  ["Google ads", "Ads"],
  ["Website / SEO", "Articles"],
  ["Newsletter", "Email"],
] as const;

export function ChannelsPage({ overview }: PageProps) {
  return (
    <div className="page-body">
      <section className="panel">
        <h3>Social accounts</h3>
        <ul className="list">
          {SOCIAL_PROVIDERS.map(([provider, label]) => {
            const connected = overview.channels.find(
              (channel) => channel.provider === provider,
            );
            return (
              <li key={provider} className="crow">
                <span className="grow">
                  <b>{label}</b>
                  <br />
                  <span className="note">
                    {connected
                      ? (connected.handle ??
                        connected.displayName ??
                        "Connected")
                      : "Social"}
                  </span>
                </span>
                {connected ? (
                  <span
                    className={
                      connected.status === "ACTIVE" ? "tag ok" : "tag warn"
                    }
                  >
                    {connected.status === "ACTIVE" ? "Connected" : "Reconnect"}
                  </span>
                ) : (
                  <a
                    className="button button-secondary button-small"
                    href={overview.connectChannelUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Connect
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      <section className="panel">
        <h3>Coming soon</h3>
        <ul className="list">
          {COMING_SOON.map(([label, kind]) => (
            <li key={label} className="crow">
              <span className="grow">
                <b>{label}</b>
                <br />
                <span className="note">{kind}</span>
              </span>
              <span className="tag">Not yet</span>
            </li>
          ))}
        </ul>
      </section>
      <p className="note">
        Channels come from Sokosumi. Whatever Cuso can reach, he plans for.
      </p>
    </div>
  );
}

export function SettingsPage({
  overview,
  name,
  email,
  signOut,
}: PageProps & {
  name: string;
  email: string;
  signOut: () => Promise<void>;
}) {
  return (
    <div className="page-body">
      <section className="panel">
        <h3>Plan and billing</h3>
        <div className="li">
          <span className={overview.subscriptionActive ? "tag ok" : "tag"}>
            {planLabel(overview.billing.plan)}
          </span>
          <span className="grow note">
            {overview.subscriptionActive
              ? "Cuso is executing your strategy."
              : "Cuso drafts until the business has an active plan."}
          </span>
          <a
            className="button button-secondary button-small"
            href={overview.subscribeUrl}
            target="_blank"
            rel="noreferrer"
          >
            Manage
          </a>
        </div>
      </section>
      <section className="panel">
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
      <section className="panel">
        <h3>Autonomy</h3>
        <p className="muted">
          Full autopilot. You approve the strategy; Cuso runs everything inside
          it and tells you what he did.
        </p>
      </section>
      <section className="panel">
        <h3>What Cuso does when</h3>
        <p className="muted">
          Every routine works from your strategy. Nothing runs until you approve
          it.
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
                  overview.strategyApprovedAt
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
      <section className="panel">
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

function planLabel(plan: string | null): string {
  if (!plan) return "No plan";
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}
