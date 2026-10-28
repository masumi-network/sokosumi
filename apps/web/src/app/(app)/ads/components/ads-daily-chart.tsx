"use client";

import { useFormatter, useTranslations } from "next-intl";
import { type KeyboardEvent, useId, useState } from "react";

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
 * Only the keyboard's readout is announced, so moving the pointer over the bars
 * stays quiet.
 */
export function AdsDailyChart({
  days,
  formatValue,
  label,
}: AdsDailyChartProps) {
  const t = useTranslations("App.Ads.campaignDetails.performance");
  const formatter = useFormatter();
  const hintId = useId();
  const [active, setActive] = useState<number | null>(null);
  const [announced, setAnnounced] = useState<number | null>(null);
  const max = Math.max(...days.map(({ value }) => value), 0);
  const last = days.length - 1;

  const formatDay = (date: string) => adsDay(formatter, date);
  const readout = (index: number | null) => {
    const day = index === null ? undefined : days[index];
    return day ? `${formatDay(day.date)} · ${formatValue(day.value)}` : null;
  };

  function show(index: number | null): void {
    setActive(index);
    setAnnounced(index);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    show(Math.min(Math.max((active ?? last) + step, 0), last));
  }

  const labelled = [...new Set([0, Math.floor(last / 2), last])];

  return (
    <div
      aria-describedby={hintId}
      aria-label={label}
      className="flex flex-col gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4"
      role="group"
      tabIndex={0}
      onBlur={() => show(null)}
      onFocus={() => show(active ?? last)}
      onKeyDown={handleKeyDown}
      onPointerLeave={() => setActive(null)}
    >
      <span className="sr-only" id={hintId}>
        {t("chartHint")}
      </span>
      <p
        aria-hidden
        className="text-muted-foreground min-h-5 text-sm tabular-nums"
        data-testid="daily-readout"
      >
        {readout(active)}
      </p>
      <p className="sr-only" role="status">
        {readout(announced)}
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
                    ? "fill-foreground"
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
