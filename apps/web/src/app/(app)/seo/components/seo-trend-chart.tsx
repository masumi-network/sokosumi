"use client";

import type { ProjectSeoMetric } from "@sokosumi/core-client";
import {
  BadgeCheck,
  CircleCheck,
  type LucideIcon,
  PenLine,
  ScanSearch,
} from "lucide-react";
import { useFormatter } from "next-intl";
import { type KeyboardEvent, type PointerEvent, useId, useState } from "react";
import {
  useSeoResultFormatter,
  useSeoResultTranslations,
} from "@/i18n/use-seo-result-translations";
import { cn } from "@/lib/utils";
import {
  SEO_MARKER_KINDS,
  type SeoChartMarker,
  type SeoMarkerKind,
  seoChartEvents,
  seoTrendModel,
} from "./seo-trend-model";

interface SeoTrendChartProps {
  report?: boolean;
  points: ProjectSeoMetric["points"];
  unit: ProjectSeoMetric["unit"];
  /** What the chart shows: "Search clicks". */
  label: string;
  formatValue: (value: number) => string;
  /** Text for a day without a measurement. */
  unavailable: string;
  /** Events on the site, drawn as a dashed line and an icon on their day. */
  markers?: SeoChartMarker[];
  /** The points are single reads: a line joins neighbouring reads (seoTrendModel `joinReads`). */
  joinReads?: boolean;
  /** Replaces the note under a position axis, which speaks of days without impressions. */
  positionNote?: string;
  /** The metric's source and key, which choose the Google updates shaded behind it. */
  series: Pick<ProjectSeoMetric, "source" | "key">;
}

/** Share of a day band a bar fills; the rest is the gap between bars. */
const BAR_FILL = 0.7;

/** Width of a marker icon, `size-3.5`, in rem so it follows the reader's font size. */
const MARKER_ICON_REM = 0.875;

const MARKER_ICONS: Record<SeoMarkerKind, LucideIcon> = {
  audit: ScanSearch,
  change: PenLine,
  task: CircleCheck,
  verified: BadgeCheck,
};

/**
 * One daily metric on one axis: bars for counts, a line for rates and positions,
 * a hairline grid, and a readout that snaps to the nearest day from the pointer
 * or the arrow keys. Callers that need every value readable without the pointer
 * add a table, as the traffic tiles do.
 */
export function SeoTrendChart({
  points,
  unit,
  label,
  formatValue,
  unavailable,
  markers,
  joinReads,
  positionNote,
  series,
  report = false,
}: SeoTrendChartProps) {
  const t = useSeoResultTranslations("App.Seo.overview", report);
  const local = useFormatter();
  const english = useSeoResultFormatter();
  const format = report ? english : local;
  const hintId = useId();
  const [active, setActive] = useState<number | null>(null);
  const [announced, setAnnounced] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const model = seoTrendModel(
    points,
    unit,
    markers,
    joinReads,
    seoChartEvents(series),
  );
  const last = points.length - 1;
  const day = (date: string) =>
    format.dateTime(new Date(`${date}T12:00:00Z`), {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  const value = (point: { value: number | null }) =>
    point.value === null ? unavailable : formatValue(point.value);
  const fullDay = (date: string) =>
    format.dateTime(new Date(`${date}T12:00:00Z`), {
      dateStyle: "medium",
      timeZone: "UTC",
    });
  // A range that crosses years needs both years; same-year dates stay compact.
  const updateDay = (date: string, other: string) =>
    date.slice(0, 4) === other.slice(0, 4) ? day(date) : fullDay(date);
  const kindName = (kind: SeoMarkerKind) => t("markerKind", { kind });
  const eventsOn = (date: string) =>
    (model.changes.find((change) => change.date === date)?.events ?? []).map(
      (event) =>
        event.label
          ? t("markerEvent", { kind: kindName(event.kind), label: event.label })
          : kindName(event.kind),
    );
  // A day carries the events on the site and the Google updates that run on it.
  const changeOn = (date: string) => {
    const labels = [...eventsOn(date), ...model.updatesOn(date)];
    return labels.length ? labels : undefined;
  };
  const readout = (index: number | null) => {
    const point = index === null ? undefined : model.points[index];
    if (!point) return null;
    const changed = changeOn(point.date);
    return `${day(point.date)} · ${value(point)}${changed ? ` · ${format.list(changed)}` : ""}`;
  };
  const path = (indices: number[]) =>
    indices
      .map((index) => {
        const point = model.points[index];
        return `${point.x.toFixed(2)},${(point.y ?? 0).toFixed(2)}`;
      })
      .join(" ");
  function show(index: number | null) {
    setActive(index);
    setAnnounced(index);
  }
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    show(Math.min(Math.max((active ?? last) + step, 0), last));
  }
  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    if (!box.width) return;
    const at = ((event.clientX - box.left) / box.width) * 100;
    let nearest = 0;
    model.points.forEach((point, index) => {
      if (Math.abs(point.x - at) < Math.abs(model.points[nearest].x - at))
        nearest = index;
    });
    setActive(nearest);
  }
  const focus = active === null ? null : model.points[active];
  const labelled = [...new Set([0, Math.floor(last / 2), last])];
  const barWidth = model.band * BAR_FILL;
  const plottedChanges = model.changes.filter(
    (change): change is typeof change & { x: number } => change.x !== null,
  );
  // The key names only the icons drawn; a weaker event of a marked day is in the readout.
  const markedKinds = SEO_MARKER_KINDS.filter((kind) =>
    plottedChanges.some((change) => change.kind === kind),
  );
  return (
    <figure lang={report ? "en" : undefined} className="min-w-0 space-y-3">
      <div
        role="group"
        aria-label={label}
        aria-describedby={hintId}
        tabIndex={0}
        className="focus-visible:ring-ring rounded-md focus-visible:ring-2 focus-visible:ring-offset-4 focus-visible:outline-none"
        onFocus={() => {
          setFocused(true);
          show(active ?? last);
        }}
        onBlur={() => {
          setFocused(false);
          show(null);
        }}
        onKeyDown={handleKeyDown}
        onPointerLeave={(event) => {
          // Keep the day under a lifted finger and the day the keyboard is on.
          if (event.pointerType === "mouse" && !focused) setActive(null);
        }}
      >
        <span className="sr-only" id={hintId}>
          {t("chartHint")}
        </span>
        <p className="sr-only" role="status">
          {readout(announced)}
        </p>
        {/* The readout names the day it belongs to, and only while one is chosen. */}
        <p
          aria-hidden
          data-testid="seo-trend-readout"
          className="text-muted-foreground min-h-5 pb-2 text-xs"
        >
          {focus ? (
            <>
              {day(focus.date)}:{" "}
              <span className="text-foreground font-semibold tabular-nums">
                {value(focus)}
              </span>
              {changeOn(focus.date)
                ? ` · ${format.list(changeOn(focus.date) ?? [])}`
                : null}
            </>
          ) : null}
        </p>
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2">
          <div
            aria-hidden
            className="text-muted-foreground relative h-48 min-w-8 text-right text-xs tabular-nums"
          >
            {model.ticks.map((tick) => (
              <span
                key={tick.value}
                className="absolute right-0 -translate-y-1/2"
                style={{ top: `${tick.y}%` }}
              >
                {formatValue(tick.value)}
              </span>
            ))}
          </div>
          <div
            className="relative h-48 touch-pan-y"
            onPointerMove={handlePointerMove}
            onPointerDown={handlePointerMove}
          >
            <svg
              aria-hidden
              // Drawn from the first day to the last when the chart mounts.
              className="chart-wipe absolute inset-0 size-full overflow-visible"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              {/* Google updates lie behind the grid and the data. */}
              {model.updates.map((update) => (
                <rect
                  key={`update:${update.name}`}
                  data-testid="seo-trend-update"
                  className="fill-quinary"
                  x={update.x}
                  width={update.width}
                  y={0}
                  height={100}
                />
              ))}
              {model.ticks.map((tick) => (
                <line
                  key={tick.value}
                  className="stroke-border"
                  vectorEffect="non-scaling-stroke"
                  x1={0}
                  x2={100}
                  y1={tick.y}
                  y2={tick.y}
                />
              ))}
              {model.bars
                ? model.points.map((point, index) =>
                    point.y === null ? null : point.value === 0 ? (
                      // A measured zero sits on the baseline; a missing day draws nothing.
                      <line
                        key={point.date}
                        data-testid="seo-trend-bar"
                        className="stroke-chart-5"
                        vectorEffect="non-scaling-stroke"
                        strokeWidth={2}
                        x1={point.x - barWidth / 2}
                        x2={point.x + barWidth / 2}
                        y1={100}
                        y2={100}
                      />
                    ) : (
                      <rect
                        key={point.date}
                        data-testid="seo-trend-bar"
                        // Neutral marks keep the data quiet next to the agent's actions; the hovered day lifts to full contrast.
                        className={
                          active === index ? "fill-foreground" : "fill-chart-5"
                        }
                        x={point.x - barWidth / 2}
                        width={barWidth}
                        y={point.y}
                        height={100 - point.y}
                      />
                    ),
                  )
                : null}
              {(model.bars ? [] : model.lines).map((run) => (
                <polyline
                  key={`line:${run[0]}`}
                  className="stroke-chart-5"
                  fill="none"
                  points={path(run)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {model.changes.map((change) =>
                change.x === null ? null : (
                  <line
                    key={`change:${change.date}`}
                    data-testid="seo-trend-change"
                    className="stroke-muted-foreground"
                    vectorEffect="non-scaling-stroke"
                    strokeDasharray="3 3"
                    x1={change.x}
                    x2={change.x}
                    y1={0}
                    y2={100}
                  />
                ),
              )}
              {focus && !model.bars ? (
                <line
                  className="stroke-muted-foreground"
                  vectorEffect="non-scaling-stroke"
                  x1={focus.x}
                  x2={focus.x}
                  y1={0}
                  y2={100}
                />
              ) : null}
            </svg>
            {model.points.map((point, index) =>
              !model.bars &&
              point.y !== null &&
              (model.dots.includes(index) || index === active) ? (
                <span
                  key={point.date}
                  aria-hidden
                  data-testid="seo-trend-dot"
                  className="bg-foreground ring-background pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2"
                  style={{ left: `${point.x}%`, top: `${point.y}%` }}
                />
              ) : null,
            )}
          </div>
          {plottedChanges.length ? (
            <>
              <span />
              {/* One icon per marked day, under its dashed line: the strongest event of that day. */}
              <div aria-hidden className="relative h-4">
                {plottedChanges.map((change) => {
                  const Icon = MARKER_ICONS[change.kind];
                  return (
                    <Icon
                      key={change.date}
                      data-testid="seo-trend-marker"
                      className={cn(
                        "absolute size-3.5",
                        change.kind === "verified"
                          ? "text-foreground"
                          : "text-muted-foreground",
                      )}
                      // Centred on its day, held inside the plot at either edge.
                      style={{
                        left: `clamp(0px, calc(${change.x}% - ${MARKER_ICON_REM / 2}rem), calc(100% - ${MARKER_ICON_REM}rem))`,
                      }}
                    />
                  );
                })}
              </div>
            </>
          ) : null}
          <span />
          <div
            aria-hidden
            className="text-muted-foreground relative h-4 text-xs tabular-nums"
          >
            {labelled.map((index) => {
              const x = model.points[index].x;
              return (
                <span
                  key={index}
                  className="absolute whitespace-nowrap"
                  style={
                    x > 50
                      ? { right: `${100 - x}%` }
                      : x < 50
                        ? { left: `${x}%` }
                        : { left: "50%", transform: "translateX(-50%)" }
                  }
                >
                  {day(model.points[index].date)}
                </span>
              );
            })}
          </div>
        </div>
      </div>
      {/* One short key for the marks; the readout names each day's events. */}
      {markedKinds.length || model.updatesAsOf ? (
        <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {markedKinds.map((kind) => {
            const Icon = MARKER_ICONS[kind];
            return (
              <li key={kind} className="flex items-center gap-1.5">
                <Icon aria-hidden className="size-3.5 shrink-0" />
                {kindName(kind)}
              </li>
            );
          })}
          {model.updates.map((update) => (
            <li key={update.name} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="bg-quinary border-border size-3 shrink-0 rounded-xs border"
              />
              {update.open
                ? t("googleUpdateOpen", {
                    name: update.name,
                    from: day(update.first),
                  })
                : update.last && update.last !== update.first
                  ? t("googleUpdate", {
                      name: update.name,
                      from: updateDay(update.first, update.last),
                      to: updateDay(update.last, update.first),
                    })
                  : t("googleUpdateDay", {
                      name: update.name,
                      day: day(update.first),
                    })}
            </li>
          ))}
          {/* Past the last known update the chart can miss one, so the date shows; otherwise only a screen reader hears it. */}
          {model.updatesAsOf &&
          (points.at(-1)?.date ?? "") > model.updatesAsOf ? (
            <li>
              {t("googleUpdatesAsOf", { day: fullDay(model.updatesAsOf) })}
            </li>
          ) : (
            model.updatesAsOf && (
              <li className="sr-only">
                {t("googleUpdatesAsOf", { day: fullDay(model.updatesAsOf) })}
              </li>
            )
          )}
        </ul>
      ) : null}
      {/* Events after the newest reported day have no place on the plot yet, so they stay in words. */}
      {model.changes.some((change) => change.x === null) ? (
        <ul className="text-muted-foreground space-y-0.5 text-xs">
          {model.changes
            .filter((change) => change.x === null)
            .map((change) => (
              <li key={change.date}>
                {t("markerLater", {
                  day: day(change.date),
                  events: format.list(eventsOn(change.date)),
                })}
              </li>
            ))}
        </ul>
      ) : null}
      {/* Every day in words for a screen reader, which cannot steer the readout in browse mode. */}
      <table className="sr-only">
        <thead>
          <tr>
            <th scope="col">{t("day")}</th>
            <th scope="col">{label}</th>
            <th scope="col">{t("markerEvents")}</th>
          </tr>
        </thead>
        <tbody>
          {model.points.map((point) => (
            <tr key={point.date}>
              <td>{day(point.date)}</td>
              <td>{value(point)}</td>
              <td>{format.list(changeOn(point.date) ?? [])}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {model.inverted ? (
        <figcaption className="text-muted-foreground text-xs">
          {positionNote ?? t("positionAxis")}
        </figcaption>
      ) : null}
    </figure>
  );
}
