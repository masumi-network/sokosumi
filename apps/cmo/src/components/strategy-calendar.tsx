import type { CmoOverview } from "@sokosumi/core-client";

type Strategy = NonNullable<CmoOverview["strategy"]>;

const AUTONOMY_LABELS = {
  drafts: "Drafts only",
  ask: "Ask me first",
  autopilot: "Autopilot",
} as const;

interface StrategyCalendarProps {
  strategy: Strategy;
  setAutonomy: (formData: FormData) => Promise<void>;
}

/** Entries grouped by date, so the month reads as a content calendar. */
export function groupCalendar(calendar: Strategy["calendar"]) {
  const days = new Map<string, Strategy["calendar"]>();
  for (const entry of [...calendar].sort((a, b) =>
    a.date.localeCompare(b.date),
  )) {
    days.set(entry.date, [...(days.get(entry.date) ?? []), entry]);
  }
  return [...days.entries()];
}

export function StrategyCalendar({
  strategy,
  setAutonomy,
}: StrategyCalendarProps) {
  return (
    <section className="stack">
      <h2>Plan for {strategy.month}</h2>
      <p>{strategy.summary}</p>
      <ul className="tags">
        {strategy.goals.map((goal) => (
          <li key={goal}>{goal}</li>
        ))}
      </ul>

      <h3>Channels</h3>
      <ul className="rows">
        {strategy.channels.map((channel) => (
          <li key={channel.channel} className="row">
            <strong>{channel.channel}</strong>
            <span className="note">{channel.cadence}</span>
            <form action={setAutonomy} className="inline">
              <input type="hidden" name="channel" value={channel.channel} />
              <select
                name="autonomy"
                defaultValue={channel.autonomy}
                aria-label={`What Cuso may do on ${channel.channel}`}
              >
                {Object.entries(AUTONOMY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <button type="submit">Save</button>
            </form>
          </li>
        ))}
      </ul>

      <h3>Calendar</h3>
      <ol className="calendar">
        {groupCalendar(strategy.calendar).map(([date, entries]) => (
          <li key={date}>
            <time dateTime={date}>{date}</time>
            <ul className="rows">
              {entries.map((entry) => (
                <li key={entry.id} className="entry">
                  <span className="note">
                    {entry.channel} · {entry.format} · {entry.status}
                  </span>
                  <strong>{entry.title}</strong>
                  {entry.brief ? <span>{entry.brief}</span> : null}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>

      {(strategy.weeklyReviews ?? []).length > 0 ? (
        <>
          <h3>Weekly reviews</h3>
          <ul className="rows">
            {(strategy.weeklyReviews ?? []).map((review) => (
              <li key={review.weekOf} className="entry">
                <strong>Week of {review.weekOf}</strong>
                <span>{review.summary}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
