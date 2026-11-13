"use client";

import { Maximize2, Minus, Plus } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  useId,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  SEO_MAP_RADIUS,
  type SeoKeywordPoint,
  seoKeywordMap,
  seoNearestPoint,
} from "./seo-keyword-map-model";
import { SEO_MAP_MAX_ZOOM, useSeoMapZoom } from "./seo-keyword-map-zoom";
import {
  SEO_DIFFICULTY_HARD_FROM,
  SEO_DIFFICULTY_MEDIUM_FROM,
  type SeoKeywordGroup,
} from "./seo-keyword-rows-model";
import { SeoFoldSummary } from "./seo-shared";

/** How far from a dot, in px, the pointer still picks it. */
const POINTER_REACH = 16;
/** From this dot on, the dots come in together: a map of many keywords does not keep the reader waiting. */
const DOT_STAGGER_MAX = 12;
/** Room in px between the frame and the outer dots, so no dot is cut at an edge. */
const PAD = 12;
/** From this zoom on, the lines at 2 and 5 times a decade show: a decade then fills most of the frame. */
const MINOR_FROM = 2;
/** The plot height: one class for the axis column and the frame, so the labels stand on their lines. */
const PLOT_HEIGHT = "h-64 sm:h-80";
/** The three bands of the Difficulty column, with the place of their word on the axis. */
const BANDS = [
  { band: "easy", middle: SEO_DIFFICULTY_MEDIUM_FROM / 2 },
  {
    band: "medium",
    middle: (SEO_DIFFICULTY_MEDIUM_FROM + SEO_DIFFICULTY_HARD_FROM) / 2,
  },
  { band: "hard", middle: (SEO_DIFFICULTY_HARD_FROM + 100) / 2 },
] as const;

/**
 * Searches a month against keyword difficulty: a keyword high and to the left is worth the most work.
 * The pointer or the arrow keys pick a keyword and a card gives its numbers; the table under it gives
 * every number without a pointer. The map pans and zooms (drag, pinch, the buttons, or + and - keys), so a
 * cluster of easy keywords pulls apart.
 */
export function SeoKeywordMap({
  groups,
}: {
  groups: { checked: SeoKeywordGroup[]; ideas: SeoKeywordGroup[] };
}) {
  const t = useTranslations("App.Seo.keywords");
  const format = useFormatter();
  const hintId = useId();
  const subtitleId = useId();
  const { frame, size, transform, zoomBy } = useSeoMapZoom();
  // By keyword, so a refetch that reorders the dots keeps the card on its keyword.
  const [activeId, setActiveId] = useState<string | null>(null);
  // The keyboard keeps its keyword when the mouse leaves the map.
  const [keyed, setKeyed] = useState(false);
  const map = seoKeywordMap(groups);
  if (!map) return null;
  const { points, ticks, minorTicks } = map;
  const { k, x: panX, y: panY } = transform;
  const measured = size.width > 0 && size.height > 0;
  // Map units, 0 to 100, to px of the zoomed frame.
  const toX = (value: number) =>
    (PAD + (value / 100) * (size.width - 2 * PAD)) * k + panX;
  const toY = (value: number) =>
    (PAD + (value / 100) * (size.height - 2 * PAD)) * k + panY;
  const inX = (px: number) => px >= 0 && px <= size.width;
  const inY = (px: number) => px >= 0 && px <= size.height;
  const lines = [
    ...ticks.map((tick) => ({ ...tick, minor: false })),
    ...(k >= MINOR_FROM
      ? minorTicks.map((tick) => ({ ...tick, minor: true }))
      : []),
  ].filter((tick) => !measured || inY(toY(tick.y)));
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
  const details = (point: SeoKeywordPoint) => [
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
    const inner = { width: box.width - 2 * PAD, height: box.height - 2 * PAD };
    // The pointer back in map units: the zoom undone, then the padding.
    setActive(
      seoNearestPoint(
        points,
        {
          x:
            (((event.clientX - box.left - panX) / k - PAD) / inner.width) * 100,
          y:
            (((event.clientY - box.top - panY) / k - PAD) / inner.height) * 100,
        },
        { width: inner.width * k, height: inner.height * k },
        POINTER_REACH,
      ),
    );
  }
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") return setActive(null);
    // Ctrl or Cmd with + or - is the zoom of the page: keep it for readers who need it.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const factor = { "+": 2, "=": 2, "-": 0.5, "0": null }[event.key];
    if (factor !== undefined) {
      event.preventDefault();
      return zoomBy(factor);
    }
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
  const zoomButton = "size-10 md:size-8";
  return (
    <figure className="bg-card-background min-w-0 space-y-4 rounded-xl p-4 sm:p-5">
      <figcaption className="flex items-start justify-between gap-4">
        {/* One line says how to read the map: no note under it, no label inside it. */}
        <span className="min-w-0 space-y-1">
          <span className="block font-semibold">{t("map.title")}</span>
          <span id={subtitleId} className="text-muted-foreground block text-sm">
            {t("map.subtitle")}
          </span>
        </span>
        {/* The zoom stands beside the title, not over the dots. */}
        <span className="flex shrink-0 gap-1">
          {k > 1 ? (
            <Button
              variant="ghost"
              size="icon"
              className={zoomButton}
              aria-label={t("map.zoomReset")}
              onClick={() => zoomBy(null)}
            >
              <Maximize2 />
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="icon"
            className={zoomButton}
            aria-label={t("map.zoomOut")}
            disabled={k <= 1}
            onClick={() => zoomBy(0.5)}
          >
            <Minus />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className={zoomButton}
            aria-label={t("map.zoomIn")}
            disabled={k >= SEO_MAP_MAX_ZOOM}
            onClick={() => zoomBy(2)}
          >
            <Plus />
          </Button>
        </span>
      </figcaption>
      {/* Identity by fill, not by color alone: filled for a keyword of yours, a ring for an idea. A map of
          one kind needs no legend. */}
      {points.some((point) => point.checked) &&
      points.some((point) => !point.checked) ? (
        <p aria-hidden className="text-muted-foreground flex gap-4 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="bg-chart-5 size-2.5 rounded-full" />
            {t("map.checked")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="border-chart-5 size-2.5 rounded-full border-2" />
            {t("ideas.short")}
          </span>
        </p>
      ) : null}
      <div
        role="group"
        aria-label={t("map.title")}
        aria-describedby={`${subtitleId} ${hintId}`}
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
            ? `${focus.group.lead.keyword}: ${format.list(details(focus))}`
            : null}
        </p>
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2">
          <div
            aria-hidden
            className={cn(
              "text-muted-foreground relative min-w-8 overflow-hidden text-right text-xs tabular-nums",
              PLOT_HEIGHT,
            )}
          >
            {lines.map((tick) => (
              <span
                key={tick.value}
                className="absolute right-0 -translate-y-1/2"
                style={{
                  top: measured ? toY(tick.y) : `${tick.y}%`,
                }}
              >
                {count(tick.value)}
              </span>
            ))}
          </div>
          <div
            ref={frame}
            data-testid="seo-keyword-map"
            className={cn(
              "relative cursor-grab overflow-hidden rounded-md active:cursor-grabbing",
              PLOT_HEIGHT,
            )}
            onPointerMove={pick}
            onPointerDown={pick}
            onPointerLeave={(event) => {
              // Keep the keyword under a lifted finger and the one the keyboard is on.
              if (event.pointerType === "mouse" && !keyed) setActive(null);
            }}
          >
            {measured ? (
              <svg
                aria-hidden
                className="absolute inset-0 size-full"
                viewBox={`0 0 ${size.width} ${size.height}`}
              >
                {lines.map((tick) => (
                  <line
                    key={tick.value}
                    className="stroke-border"
                    strokeDasharray={tick.minor ? "2 4" : undefined}
                    x1={0}
                    x2={size.width}
                    y1={toY(tick.y)}
                    y2={toY(tick.y)}
                  />
                ))}
                {/* Where Easy turns Medium and Medium turns Hard: the words of the Difficulty column. */}
                {[SEO_DIFFICULTY_MEDIUM_FROM, SEO_DIFFICULTY_HARD_FROM].map(
                  (edge) => (
                    <line
                      key={edge}
                      className="stroke-border"
                      strokeDasharray="2 4"
                      x1={toX(edge)}
                      x2={toX(edge)}
                      y1={0}
                      y2={size.height}
                    />
                  ),
                )}
              </svg>
            ) : null}
            {points.map((point, index) => {
              const left = measured ? toX(point.x) : `${point.x}%`;
              const top = measured ? toY(point.y) : `${point.y}%`;
              return (
                <span
                  key={point.group.lead.id}
                  aria-hidden
                  data-testid="seo-keyword-dot"
                  className={cn(
                    "ring-background pop-in stagger-delay pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 transition-colors duration-150 motion-reduce:transition-none",
                    // The picked dot sits over a neighbour it touches.
                    index === active && "z-[1]",
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
                  style={
                    {
                      left,
                      top,
                      width: SEO_MAP_RADIUS * 2,
                      height: SEO_MAP_RADIUS * 2,
                      // The dots come in one by one, by their place in the list, not by size.
                      "--stagger-index": Math.min(index, DOT_STAGGER_MAX),
                      "--stagger-step": "30ms",
                    } as CSSProperties
                  }
                />
              );
            })}
            {focus ? (
              <div
                aria-hidden
                data-testid="seo-keyword-card"
                className="bg-popover text-popover-foreground pointer-events-none absolute z-10 w-max max-w-[min(14rem,100%)] rounded-md border px-3 py-2 text-xs shadow-md"
                // In the other half of the frame from the dot: it never covers the dot or leaves the screen.
                style={{
                  ...((measured ? toX(focus.x) / size.width : focus.x / 100) >
                  0.5
                    ? { left: 8 }
                    : { right: 8 }),
                  ...((measured ? toY(focus.y) / size.height : focus.y / 100) <
                  0.5
                    ? { bottom: 8 }
                    : { top: 8 }),
                }}
              >
                <p className="font-medium break-words">
                  {focus.group.lead.keyword}
                </p>
                {details(focus).map((line) => (
                  <p key={line} className="text-muted-foreground tabular-nums">
                    {line}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
          <span />
          {/* The bands of the Difficulty column under the frame, so the axis reads in the list's own words. */}
          <div
            aria-hidden
            className="text-muted-foreground relative h-4 overflow-hidden text-xs"
          >
            {BANDS.map(({ band, middle }) => {
              const at = measured ? toX(middle) : null;
              return at === null || inX(at) ? (
                <span
                  key={band}
                  className="absolute -translate-x-1/2 whitespace-nowrap"
                  style={{ left: at ?? `${middle}%` }}
                >
                  {t(`difficulty.${band}`)}
                </span>
              ) : null;
            })}
          </div>
        </div>
      </div>
      <details className="text-sm">
        <SeoFoldSummary className="text-muted-foreground py-1 text-xs">
          {t("map.table")}
        </SeoFoldSummary>
        <p className="text-muted-foreground pt-2 text-xs">{t("map.source")}</p>
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
