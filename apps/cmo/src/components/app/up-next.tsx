import type { CmoOverview } from "@sokosumi/core-client";

import { useTransition } from "react";
import { AGENT_NAME } from "../../lib/agent";
import { channelLabel, relativeDay } from "../../lib/calendar";
import { productionShare, productionSteps } from "../../lib/production";
import { strategyApproved } from "../../lib/strategy";
import { ChannelIcon } from "../channel-icon";
import { type StartTopUp, TopUpButton } from "../top-up";

interface UpNextProps {
  overview: CmoOverview;
  today: string;
  compose: (text: string) => void;
  /** Cancels the entry's post and takes it out of the plan. */
  pause: (id: string) => Promise<void>;
  close: () => void;
  /** The top-up checkout, or null when this Cuso may not top up. */
  topUp: StartTopUp | null;
}

const STATUS_LABELS: Record<string, string> = {
  idea: "Planned",
  draft: "Drafted",
  scheduled: "Scheduled",
};

/** After approval: Cuso making the whole month, piece by piece. */
function MonthProduction({
  production,
}: {
  production: CmoOverview["production"];
}) {
  if (
    production.state !== "running" &&
    production.state !== "starting" &&
    production.state !== "stuck"
  )
    return null;
  const share = productionShare(production);
  return (
    <section className="ugroup">
      <span className="label">Your month</span>
      <div className="uitem working">
        <div className="top">
          {production.state === "running" ? (
            <span className="dot live" aria-hidden="true" />
          ) : null}
          <span className="uchannel">{AGENT_NAME}</span>
          <span className="when num">
            {production.ready} of {production.total}
          </span>
        </div>
        <span className="utitle">
          {production.state === "running" ||
          (production.state === "starting" && production.written > 0)
            ? productionSteps(production)
            : production.state === "starting"
              ? "Starting on every post, picture and ad for the month"
              : `A few pieces didn't finish. ${AGENT_NAME} tries again later.`}
        </span>
        <span
          className="uprogress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={share}
          aria-label="Month made"
        >
          <span style={{ width: `${share}%` }} />
        </span>
      </div>
    </section>
  );
}

/** What Cuso is doing now and what comes next, from the real calendar. */
export function UpNext({
  overview,
  today,
  compose,
  pause,
  close,
  topUp,
}: UpNextProps) {
  const working = overview.botStatus === "RUNNING";
  const paused = overview.billing.availableCredits <= 0;
  const runningToday = overview.upNext.filter((item) => item.date === today);
  const comingUp = overview.upNext.filter((item) => item.date !== today);
  const making =
    overview.production.state === "running" ||
    overview.production.state === "starting" ||
    overview.production.state === "stuck";
  const empty = !working && !making && overview.upNext.length === 0;
  return (
    <aside className="upnext" aria-label="Up next">
      <div className="uh">
        <b>Up next</b>
        <span className="count num">{overview.upNext.length}</span>
        <span className="sp" />
        <button
          type="button"
          className="button button-ghost button-small"
          onClick={close}
        >
          Hide
        </button>
      </div>
      <div className="ub">
        <MonthProduction production={overview.production} />
        {paused && topUp ? (
          <section className="ugroup">
            <span className="label">Paused: out of credits</span>
            <TopUpButton startTopUp={topUp} />
          </section>
        ) : null}
        {empty ? (
          <div className="empty">
            <span className="shape" aria-hidden="true" />
            <span>
              {!strategyApproved(overview)
                ? `${AGENT_NAME} starts working once you approve the strategy.`
                : overview.channels.length === 0
                  ? `Nothing queued. ${AGENT_NAME} is waiting for a connected channel.`
                  : "Nothing due on your connected channels yet."}
            </span>
          </div>
        ) : null}
        {working || runningToday.length > 0 ? (
          <section className="ugroup">
            <span className="label">Running now</span>
            {working ? (
              <div className="uitem working">
                <div className="top">
                  <span className="dot live" aria-hidden="true" />
                  <span className="uchannel">{AGENT_NAME}</span>
                  <span className="when">Now</span>
                </div>
                <span className="utitle">Working on your marketing</span>
              </div>
            ) : null}
            {runningToday.map((item) => (
              <Item
                key={item.id}
                item={item}
                today={today}
                paused={paused}
                compose={compose}
                pause={pause}
              />
            ))}
          </section>
        ) : null}
        {comingUp.length > 0 ? (
          <section className="ugroup">
            <span className="label">Coming up</span>
            {comingUp.map((item) => (
              <Item
                key={item.id}
                item={item}
                today={today}
                paused={paused}
                compose={compose}
                pause={pause}
              />
            ))}
          </section>
        ) : null}
      </div>
    </aside>
  );
}

function Item({
  item,
  today,
  paused,
  compose,
  pause,
}: {
  item: CmoOverview["upNext"][number];
  today: string;
  paused: boolean;
  compose: (text: string) => void;
  pause: (id: string) => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <div className={paused ? "uitem paused" : "uitem"}>
      <div className="top">
        <ChannelIcon channel={item.channel} size={14} />
        <span className="uchannel">{channelLabel(item.channel)}</span>
        <span className="when">{relativeDay(item.date, today)}</span>
      </div>
      <span className="utitle">{item.title}</span>
      <div className="top">
        <span className="tag">
          {paused ? "Paused" : (STATUS_LABELS[item.status] ?? item.status)}
        </span>
        <span className="acts">
          <button
            type="button"
            className="button button-ghost button-small"
            onClick={() => compose(`Change "${item.title}": `)}
          >
            Change
          </button>
          <button
            type="button"
            className="button button-ghost button-small"
            disabled={pending}
            onClick={() => startTransition(() => pause(item.id))}
          >
            {pending ? "Pausing" : "Pause"}
          </button>
        </span>
      </div>
    </div>
  );
}
