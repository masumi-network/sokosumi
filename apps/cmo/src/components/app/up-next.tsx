import type { CmoOverview } from "@sokosumi/core-client";

import { relativeDay } from "../../lib/calendar";

interface UpNextProps {
  overview: CmoOverview;
  today: string;
  compose: (text: string) => void;
  close: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  idea: "Planned",
  draft: "Drafted",
  scheduled: "Scheduled",
};

/** What Cuso is doing now and what comes next, from the real calendar. */
export function UpNext({ overview, today, compose, close }: UpNextProps) {
  const working = overview.botStatus === "RUNNING";
  const paused = overview.billing.availableCredits <= 0;
  const runningToday = overview.upNext.filter((item) => item.date === today);
  const comingUp = overview.upNext.filter((item) => item.date !== today);
  const empty = !working && overview.upNext.length === 0;
  return (
    <aside className="upnext" aria-label="Up next">
      <div className="uh">
        <b>Up next</b>
        <button
          type="button"
          className="button button-ghost button-small"
          onClick={close}
        >
          Hide
        </button>
      </div>
      <div className="ub">
        {empty ? (
          <div className="empty">
            <span className="shape" aria-hidden="true" />
            <span>
              {!overview.strategyApprovedAt
                ? "Cuso starts working once you approve the strategy."
                : overview.channels.length === 0
                  ? "Nothing queued. Cuso is waiting for a connected channel."
                  : "Nothing due on your connected channels yet."}
            </span>
          </div>
        ) : null}
        {working || runningToday.length > 0 ? (
          <section className="ugroup">
            <span className="label">Running now</span>
            {working ? (
              <div className="uitem">
                <div className="top">
                  <span className="tag accent">Cuso</span>
                  <span className="when">Now</span>
                </div>
                <span>Working on your marketing</span>
              </div>
            ) : null}
            {runningToday.map((item) => (
              <Item
                key={item.id}
                item={item}
                today={today}
                paused={paused}
                compose={compose}
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
}: {
  item: CmoOverview["upNext"][number];
  today: string;
  paused: boolean;
  compose: (text: string) => void;
}) {
  return (
    <div className={paused ? "uitem paused" : "uitem"}>
      <div className="top">
        <span className="tag">{item.channel}</span>
        <span className="when">{relativeDay(item.date, today)}</span>
      </div>
      <span>{item.title}</span>
      <div className="top">
        <span className="note">
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
            onClick={() => compose(`Pause "${item.title}"`)}
          >
            Pause
          </button>
        </span>
      </div>
    </div>
  );
}
