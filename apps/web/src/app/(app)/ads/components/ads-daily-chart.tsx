"use client";

import { useFormatter } from "next-intl";
import { type KeyboardEvent, useState } from "react";

import { adsDay } from "./ads-format";

const SLOT = 10;
const BAR = 8;
const HEIGHT = 100;

interface AdsDailyChartProps {
  /** Oldest to newest, one per day (`YYYY-MM-DD`). */
  days: readonly { date: string; value: number }[];
  /** A value as the reader reads it: "€3.50". */
  formatValue: (value: number) => string;
  /** What the chart shows, for people who cannot see it: "Spend per day". */
  label: string;
}

/**
 * Daily bars in one accent color: a baseline, no axes, and the first, middle
 * and last dates. A day's value reads out above the bars on hover and, from
 * the keyboard, with the arrow keys; every day is also in the table beside it.
 */
export function AdsDailyChart({
  days,
  formatValue,
  label,
}: AdsDailyChartProps) {
  const formatter = useFormatter();
  const formatDay = (date: string) => adsDay(formatter, date);
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(...days.map(({ value }) => value), 0);
  const last = days.length - 1;

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    setActive((current) =>
      Math.min(Math.max((current ?? last) + step, 0), last),
    );
  }

  const day = active === null ? null : days[active];
  const labelled = [...new Set([0, Math.floor(last / 2), last])];

  return (
    <div
      aria-label={label}
      className="flex flex-col gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4"
      role="group"
      tabIndex={0}
      onBlur={() => setActive(null)}
      onFocus={() => setActive((current) => current ?? last)}
      onKeyDown={handleKeyDown}
      onPointerLeave={() => setActive(null)}
    >
      <p
        className="text-muted-foreground min-h-5 text-sm tabular-nums"
        role="status"
      >
        {day ? `${formatDay(day.date)} · ${formatValue(day.value)}` : null}
      </p>
      <svg
        aria-hidden
        className="h-40 w-full"
        preserveAspectRatio="none"
        viewBox={`0 0 ${days.length * SLOT} ${HEIGHT}`}
      >
        <line
          className="stroke-border"
          vectorEffect="non-scaling-stroke"
          x1={0}
          x2={days.length * SLOT}
          y1={HEIGHT}
          y2={HEIGHT}
        />
        {days.map(({ date, value }, index) => {
          const height = max > 0 ? (value / max) * HEIGHT : 0;
          return (
            <g
              key={date}
              data-testid="daily-bar"
              onPointerEnter={() => setActive(index)}
            >
              <rect
                className="fill-transparent"
                height={HEIGHT}
                width={SLOT}
                x={index * SLOT}
                y={0}
              />
              <rect
                className={
                  active === null || active === index
                    ? "fill-primary"
                    : "fill-primary-tertiary"
                }
                height={height}
                width={BAR}
                x={index * SLOT + (SLOT - BAR) / 2}
                y={HEIGHT - height}
              />
            </g>
          );
        })}
      </svg>
      <div
        aria-hidden
        className="text-muted-foreground flex justify-between text-xs tabular-nums"
      >
        {labelled.map((index) => (
          <span key={index}>{formatDay(days[index].date)}</span>
        ))}
      </div>
    </div>
  );
}
