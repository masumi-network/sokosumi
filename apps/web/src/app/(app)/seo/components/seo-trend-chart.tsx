"use client";

import type { ProjectSeoMetric } from "@sokosumi/core-client";
import { useFormatter, useTranslations } from "next-intl";
import { type KeyboardEvent, type PointerEvent, useId, useState } from "react";
import { seoTrendModel } from "./seo-trend-model";

interface SeoTrendChartProps {
  points: ProjectSeoMetric["points"];
  unit: ProjectSeoMetric["unit"];
  /** What the chart shows: "Search clicks". */
  label: string;
  formatValue: (value: number) => string;
  /** Text for a day without a measurement. */
  unavailable: string;
  /** Recorded page changes, drawn as dashed lines on their day. */
  markers?: { date: string; label: string }[];
}

/** Share of a day band a bar fills; the rest is the gap between bars. */
const BAR_FILL = 0.7;

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
}: SeoTrendChartProps) {
  const t = useTranslations("App.Seo.overview");
  const format = useFormatter();
  const hintId = useId();
  const [active, setActive] = useState<number | null>(null);
  const [announced, setAnnounced] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const model = seoTrendModel(points, unit, markers);
  const last = points.length - 1;
  const day = (date: string) =>
    format.dateTime(new Date(`${date}T12:00:00Z`), {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  const value = (point: { value: number | null }) =>
    point.value === null ? unavailable : formatValue(point.value);
  const changeOn = (date: string) =>
    model.changes.find((change) => change.date === date)?.labels;
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
  return (
    <figure className="min-w-0 space-y-3">
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
              className="absolute inset-0 h-full w-full overflow-visible"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
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
                        className="stroke-chart-5/50"
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
              {model.changes.map((change) => (
                <line
                  key={`change:${change.date}`}
                  data-testid="seo-trend-change"
                  className="stroke-foreground"
                  vectorEffect="non-scaling-stroke"
                  strokeDasharray="3 3"
                  x1={change.x}
                  x2={change.x}
                  y1={0}
                  y2={100}
                />
              ))}
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
      {/* The marked days in words, so the lines need no pointer to read. */}
      {model.changes.length ? (
        <ul className="text-muted-foreground space-y-0.5 text-xs">
          {model.changes.map((change) => (
            <li key={change.date} className="flex gap-2">
              <span
                aria-hidden
                className="border-foreground mt-1.5 h-0 w-3 shrink-0 border-t border-dashed"
              />
              <span>
                {t("changeMarker", {
                  day: day(change.date),
                  changes: format.list(change.labels),
                })}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {model.inverted ? (
        <figcaption className="text-muted-foreground text-xs">
          {t("positionAxis")}
        </figcaption>
      ) : null}
      <details className="text-sm">
        <summary className="text-muted-foreground focus-visible:ring-ring cursor-pointer rounded-sm py-3 text-xs focus-visible:ring-2 focus-visible:outline-none">
          {t("dailyValues")}
        </summary>
        <div className="max-h-64 overflow-y-auto pt-2">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground text-left">
              <tr>
                <th scope="col" className="py-1 font-normal">
                  {t("day")}
                </th>
                <th scope="col" className="py-1 text-right font-normal">
                  {label}
                </th>
              </tr>
            </thead>
            <tbody>
              {model.points.map((point) => (
                <tr key={point.date} className="border-t">
                  <td className="py-1">{day(point.date)}</td>
                  <td className="py-1 text-right tabular-nums">
                    {value(point)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
