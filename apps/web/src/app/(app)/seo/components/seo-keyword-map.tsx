"use client";

import { useFormatter, useTranslations } from "next-intl";
import { type KeyboardEvent, type PointerEvent, useId, useState } from "react";
import { cn } from "@/lib/utils";
import {
  type SeoKeywordPoint,
  seoKeywordMap,
  seoNearestPoint,
} from "./seo-keyword-map-model";
import type { SeoKeywordGroup } from "./seo-keyword-rows-model";
import { SeoFoldSummary } from "./seo-shared";

/** How far from a dot, in px, the pointer still picks it. */
const POINTER_REACH = 16;
const X_TICKS = [0, 50, 100];

/**
 * Searches a month against keyword difficulty: a keyword high and to the left is worth the most work.
 * The pointer or the arrow keys pick a keyword and a card gives its numbers; the table under it gives
 * every number without a pointer.
 */
export function SeoKeywordMap({
  groups,
}: {
  groups: { checked: SeoKeywordGroup[]; ideas: SeoKeywordGroup[] };
}) {
  const t = useTranslations("App.Seo.keywords");
  const format = useFormatter();
  const hintId = useId();
  // By keyword, so a refetch that reorders the dots keeps the card on its keyword.
  const [activeId, setActiveId] = useState<string | null>(null);
  // The keyboard keeps its keyword when the mouse leaves the map.
  const [keyed, setKeyed] = useState(false);
  const map = seoKeywordMap(groups);
  if (!map) return null;
  const { points, ticks } = map;
  const found = points.findIndex((point) => point.group.lead.id === activeId);
  const active = found < 0 ? null : found;
  const setActive = (index: number | null) =>
    setActiveId(index === null ? null : (points[index]?.group.lead.id ?? null));
  const count = (value: number) =>
    format.number(value, { notation: "compact" });
  const position = (point: SeoKeywordPoint) =>
    point.group.best !== null
      ? t("ranked", { position: point.group.best })
      : point.checked && point.group.reads.length
        ? t("notFound")
        : null;
  const lines = (point: SeoKeywordPoint) => [
    // Said in words too: the ring of an idea is not the only sign.
    ...(point.checked ? [] : [t("map.idea")]),
    `${format.number(point.volume)} ${t("volumeUnit", { count: point.volume })}`,
    t("map.difficulty", { value: Math.round(point.difficulty) }),
    ...(position(point) ? [position(point) ?? ""] : []),
    ...(point.gain
      ? [
          t("map.top10", { clicks: point.gain.top10 }),
          t("map.top3", { clicks: point.gain.top3 }),
        ]
      : []),
  ];
  const focus = active === null ? null : points[active];
  function pick(event: PointerEvent<HTMLDivElement>) {
    setKeyed(false);
    const box = event.currentTarget.getBoundingClientRect();
    if (!box.width || !box.height) return;
    setActive(
      seoNearestPoint(
        points,
        {
          x: ((event.clientX - box.left) / box.width) * 100,
          y: ((event.clientY - box.top) / box.height) * 100,
        },
        box,
        POINTER_REACH,
      ),
    );
  }
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") return setActive(null);
    const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    setKeyed(true);
    setActive(
      Math.min(
        Math.max((active ?? (step > 0 ? -1 : points.length)) + step, 0),
        points.length - 1,
      ),
    );
  }
  // Big dots first, so a small dot is never under a big one.
  const drawn = points
    .map((point, index) => ({ point, index }))
    .toSorted((left, right) => right.point.radius - left.point.radius);
  return (
    <figure className="min-w-0 space-y-3">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-sm font-medium">{t("map.title")}</span>
        {/* Identity by fill, not by color alone: filled for a keyword of yours, a ring for an idea. */}
        <span aria-hidden className="text-muted-foreground flex gap-4 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="bg-chart-5 size-2.5 rounded-full" />
            {t("map.checked")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="border-chart-5 size-2.5 rounded-full border-2" />
            {t("ideas.short")}
          </span>
        </span>
      </figcaption>
      <div
        role="group"
        aria-label={t("map.title")}
        aria-describedby={hintId}
        tabIndex={0}
        className="focus-visible:ring-ring rounded-md focus-visible:ring-2 focus-visible:ring-offset-4 focus-visible:outline-none"
        onBlur={() => setActive(null)}
        onKeyDown={handleKeyDown}
      >
        <span className="sr-only" id={hintId}>
          {t("map.hint")}
        </span>
        <p className="sr-only" role="status">
          {focus
            ? `${focus.group.lead.keyword}: ${format.list(lines(focus))}`
            : null}
        </p>
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2">
          <div
            aria-hidden
            className="text-muted-foreground relative h-56 min-w-8 text-right text-xs tabular-nums"
          >
            {ticks.map((tick) => (
              <span
                key={tick.value}
                className="absolute right-0 -translate-y-1/2"
                style={{ top: `${tick.y}%` }}
              >
                {count(tick.value)}
              </span>
            ))}
          </div>
          <div
            data-testid="seo-keyword-map"
            className="relative h-56 touch-pan-y"
            onPointerMove={pick}
            onPointerDown={pick}
            onPointerLeave={(event) => {
              // Keep the keyword under a lifted finger and the one the keyboard is on.
              if (event.pointerType === "mouse" && !keyed) setActive(null);
            }}
          >
            <svg
              aria-hidden
              className="absolute inset-0 size-full overflow-visible"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              {ticks.map((tick) => (
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
            </svg>
            <span
              aria-hidden
              className="text-muted-foreground pointer-events-none absolute top-1 left-2 text-xs"
            >
              {t("map.best")}
            </span>
            {drawn.map(({ point, index }) => (
              <span
                key={point.group.lead.id}
                aria-hidden
                data-testid="seo-keyword-dot"
                className={cn(
                  "ring-background pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 transition-colors duration-150 motion-reduce:transition-none",
                  point.checked
                    ? index === active
                      ? "bg-foreground"
                      : "bg-chart-5"
                    : cn(
                        "bg-background border-2",
                        index === active
                          ? "border-foreground"
                          : "border-chart-5",
                      ),
                )}
                style={{
                  left: `${point.x}%`,
                  top: `${point.y}%`,
                  width: point.radius * 2,
                  height: point.radius * 2,
                }}
              />
            ))}
            {focus ? (
              <div
                aria-hidden
                data-testid="seo-keyword-card"
                className="bg-popover text-popover-foreground pointer-events-none absolute z-10 w-max max-w-[min(14rem,100%)] rounded-md border px-3 py-2 text-xs shadow-md"
                // In the other half of the map from the dot, inside the plot: it never covers the dot or leaves the screen.
                style={{
                  ...(focus.x > 50 ? { left: 0 } : { right: 0 }),
                  ...(focus.y < 50 ? { bottom: 0 } : { top: 0 }),
                }}
              >
                <p className="font-medium break-words">
                  {focus.group.lead.keyword}
                </p>
                {lines(focus).map((line) => (
                  <p key={line} className="text-muted-foreground tabular-nums">
                    {line}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
          <span />
          <div
            aria-hidden
            className="text-muted-foreground relative h-4 text-xs tabular-nums"
          >
            {X_TICKS.map((tick) => (
              <span
                key={tick}
                className="absolute whitespace-nowrap"
                style={
                  tick === 0
                    ? { left: 0 }
                    : tick === 100
                      ? { right: 0 }
                      : { left: "50%", transform: "translateX(-50%)" }
                }
              >
                {tick === 0
                  ? t("map.easier")
                  : tick === 100
                    ? t("map.harder")
                    : t("map.axis")}
              </span>
            ))}
          </div>
        </div>
      </div>
      <p className="text-muted-foreground text-xs">{t("map.note")}</p>
      <details className="text-sm">
        <SeoFoldSummary className="text-muted-foreground py-3 text-xs">
          {t("map.table")}
        </SeoFoldSummary>
        <div className="max-h-64 overflow-auto pt-2">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground text-left">
              <tr>
                <th scope="col" className="py-1 font-normal">
                  {t("keyword")}
                </th>
                <th scope="col" className="py-1 text-right font-normal">
                  {t("volume")}
                </th>
                <th scope="col" className="py-1 text-right font-normal">
                  {t("map.axis")}
                </th>
                <th scope="col" className="py-1 text-right font-normal">
                  {t("map.gain")}
                </th>
              </tr>
            </thead>
            <tbody>
              {points
                .toSorted(
                  (left, right) =>
                    (right.gain?.top3 ?? 0) - (left.gain?.top3 ?? 0),
                )
                .map((point) => (
                  <tr key={point.group.lead.id} className="border-t">
                    <td className="py-1 break-words">
                      {point.group.lead.keyword}
                      {point.checked ? null : (
                        <span className="text-muted-foreground">
                          {" "}
                          · {t("map.idea")}
                        </span>
                      )}
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {format.number(point.volume)}
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {Math.round(point.difficulty)}
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {point.gain ? format.number(point.gain.top3) : null}
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
