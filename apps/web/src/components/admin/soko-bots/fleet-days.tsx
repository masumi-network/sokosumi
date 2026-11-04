import type { AdminSokoBotFleetDays } from "@sokosumi/core-client";
import { getFormatter, getTranslations } from "next-intl/server";

type FleetDay = AdminSokoBotFleetDays["days"][number];

const WIDTH = 320;
const HEIGHT = 96;
const GAP = 2;

interface DayChartProps {
  days: FleetDay[];
  value: (day: FleetDay) => number;
  label: (day: FleetDay) => string;
  ariaLabel: string;
}

/** One series of daily bars; each column is a hover target showing its day. */
function DayChart({ days, value, label, ariaLabel }: DayChartProps) {
  const max = Math.max(...days.map(value), 0);
  const slot = WIDTH / Math.max(days.length, 1);
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      className="h-24 w-full"
      role="img"
      aria-label={ariaLabel}
    >
      <line
        x1={0}
        x2={WIDTH}
        y1={HEIGHT - 0.5}
        y2={HEIGHT - 0.5}
        className="stroke-border"
        strokeWidth={1}
      />
      {days.map((day, index) => {
        const height = max === 0 ? 0 : (value(day) / max) * (HEIGHT - 4);
        const x = index * slot;
        return (
          <g key={day.day} className="group">
            <title>{label(day)}</title>
            <rect x={x} y={0} width={slot} height={HEIGHT} fill="transparent" />
            {height > 0 ? (
              <rect
                x={x + GAP / 2}
                y={HEIGHT - height}
                width={Math.max(slot - GAP, 1)}
                height={height}
                rx={1.5}
                className="fill-muted-foreground group-hover:fill-foreground"
              />
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

interface FleetDaysProps {
  fleet: AdminSokoBotFleetDays;
}

/**
 * The fleet per UTC day: people who wrote to a Soko Bot, and what every turn
 * cost in model tokens. Two charts, never one with two scales.
 */
export async function FleetDays({ fleet }: FleetDaysProps) {
  const [t, format] = await Promise.all([
    getTranslations("App.Admin.SokoBots.Daily"),
    getFormatter(),
  ]);
  const { days } = fleet;
  if (days.length === 0) return null;
  const today = days[days.length - 1] as FleetDay;
  const dayName = (day: FleetDay) =>
    format.dateTime(new Date(`${day.day}T00:00:00Z`), {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  const usd = (value: number) =>
    format.number(value, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: value < 10 ? 2 : 0,
    });
  const totalCost = days.reduce((sum, day) => sum + day.costUsd, 0);
  const peakUsers = Math.max(...days.map((day) => day.users));

  const panels = [
    {
      key: "users",
      title: t("usersTitle"),
      headline: format.number(today.users),
      sub: t("usersSub", { peak: peakUsers, days: days.length }),
      value: (day: FleetDay) => day.users,
      label: (day: FleetDay) =>
        t("usersBar", {
          day: dayName(day),
          users: day.users,
          messages: day.messages,
        }),
    },
    {
      key: "cost",
      title: t("costTitle"),
      headline: usd(today.costUsd),
      sub: t("costSub", { total: usd(totalCost), days: days.length }),
      value: (day: FleetDay) => day.costUsd,
      label: (day: FleetDay) =>
        t("costBar", { day: dayName(day), cost: usd(day.costUsd) }),
    },
  ];

  return (
    <section aria-labelledby="fleet-days" className="rounded-md border">
      <h2 id="fleet-days" className="border-b px-4 py-2 text-sm font-medium">
        {t("title", { days: days.length })}
      </h2>
      <div className="grid divide-y lg:grid-cols-2 lg:divide-x lg:divide-y-0">
        {panels.map((panel) => (
          <div key={panel.key} className="space-y-2 px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-muted-foreground text-xs">{panel.title}</h3>
              <span className="text-muted-foreground text-xs">{panel.sub}</span>
            </div>
            <p className="text-xl font-semibold tabular-nums tracking-tight">
              {panel.headline}{" "}
              <span className="text-muted-foreground text-xs font-normal">
                {t("today")}
              </span>
            </p>
            <DayChart
              days={days}
              value={panel.value}
              label={panel.label}
              ariaLabel={panel.title}
            />
            <div className="text-muted-foreground flex justify-between text-2xs tabular-nums">
              <span>{dayName(days[0] as FleetDay)}</span>
              <span>{dayName(today)}</span>
            </div>
          </div>
        ))}
      </div>
      <details className="border-t">
        <summary className="hover:bg-accent text-muted-foreground cursor-pointer px-4 py-2 text-xs transition-colors">
          {t("table")}
        </summary>
        <div className="app-scrollbar max-h-72 overflow-auto">
          <table className="w-full text-xs tabular-nums">
            <thead className="text-muted-foreground bg-background sticky top-0">
              <tr className="border-b">
                <th className="px-4 py-1.5 text-start font-normal">
                  {t("day")}
                </th>
                <th className="px-4 py-1.5 text-end font-normal">
                  {t("users")}
                </th>
                <th className="px-4 py-1.5 text-end font-normal">
                  {t("messages")}
                </th>
                <th className="px-4 py-1.5 text-end font-normal">
                  {t("turns")}
                </th>
                <th className="px-4 py-1.5 text-end font-normal">
                  {t("tokens")}
                </th>
                <th className="px-4 py-1.5 text-end font-normal">
                  {t("cost")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {[...days].reverse().map((day) => (
                <tr key={day.day}>
                  <td className="px-4 py-1.5">{dayName(day)}</td>
                  <td className="px-4 py-1.5 text-end">{day.users}</td>
                  <td className="px-4 py-1.5 text-end">{day.messages}</td>
                  <td className="px-4 py-1.5 text-end">{day.turns}</td>
                  <td className="px-4 py-1.5 text-end">
                    {format.number(day.totalTokens, { notation: "compact" })}
                  </td>
                  <td className="px-4 py-1.5 text-end">{usd(day.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
