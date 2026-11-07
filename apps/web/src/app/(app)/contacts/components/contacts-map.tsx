"use client";
import type { ContactMapPlace } from "@sokosumi/core-client";
import { geoNaturalEarth1, geoPath } from "d3-geo";
import { select } from "d3-selection";
import {
  type ZoomBehavior,
  type ZoomTransform,
  zoom,
  zoomIdentity,
  zoomTransform,
} from "d3-zoom";
import { MapPin, Maximize2, Minus, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type RefCallback,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { feature, mesh } from "topojson-client";
import countries from "world-atlas/countries-110m.json";
import { coreErrorOf } from "@/app/contacts/contacts-view";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import type { ContactQuery } from "@/lib/services/contacts.client";
import { ContactAvatar } from "./contact-visuals";
import { useContactMap } from "./use-contacts-data";

type Topology = Parameters<typeof feature>[0];

const ANTARCTICA = "010";

/** The world's land without Antarctica, which holds nobody's contacts. */
function landOf(atlas: Topology) {
  const all = feature(atlas, atlas.objects.countries);
  return {
    type: "FeatureCollection" as const,
    features: ("features" in all ? all.features : [all]).filter(
      (country) => country.id !== ANTARCTICA,
    ),
  };
}

const coarse = countries as unknown as Topology;
const land = landOf(coarse);
const WIDTH = 960;
const projection = geoNaturalEarth1().fitWidth(WIDTH - 16, land);
const path = geoPath(projection);
const [[, top], [, bottom]] = path.bounds(land);
const HEIGHT = Math.ceil(bottom - top) + 16;
projection.translate([
  projection.translate()[0] + 8,
  projection.translate()[1] - top + 8,
]);

interface Outline {
  land: string | undefined;
  borders: string | undefined;
}

function outlineOf(atlas: Topology): Outline {
  return {
    land: path(landOf(atlas)) ?? undefined,
    borders:
      path(
        mesh(
          atlas,
          atlas.objects.countries as Parameters<typeof mesh>[1],
          (a, b) => a !== b,
        ),
      ) ?? undefined,
  };
}

const COARSE = outlineOf(coarse);
let fine: Promise<Outline> | undefined;
/** The sharper outline, fetched once, the first time someone zooms in. */
function loadFine(): Promise<Outline> {
  fine ??= import("world-atlas/countries-50m.json").then((module) =>
    outlineOf(module.default as unknown as Topology),
  );
  return fine;
}

const ASPECT = { aspectRatio: `${WIDTH} / ${HEIGHT}` };

/** Dots closer than this on screen merge, so each stays clickable. */
const MIN_GAP_PX = 26;
const MAX_ZOOM = 16;
/** From these zoom levels on, the map shows borders, then names and detail. */
const BORDERS_FROM = 2;
const NAMES_FROM = 3;
const FINE_FROM = 3;

/** Zoom and pan by wheel, pinch, drag and double-click, and the frame's width. */
function useMapZoom() {
  const [width, setWidth] = useState(WIDTH);
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
  const control = useRef<{
    behavior: ZoomBehavior<HTMLDivElement, unknown>;
    element: HTMLDivElement;
  } | null>(null);
  const frame: RefCallback<HTMLDivElement> = useCallback((element) => {
    if (!element) return;
    const behavior = zoom<HTMLDivElement, unknown>()
      .scaleExtent([1, MAX_ZOOM])
      .on("zoom", (event: { transform: ZoomTransform }) =>
        setTransform(event.transform),
      );
    control.current = { behavior, element };
    const selection = select(element).call(behavior);
    let lastWidth = 0;
    const observer = new ResizeObserver(([entry]) => {
      const { width: w, height: h } = entry.contentRect;
      if (!w || w === lastWidth) return;
      behavior
        .extent([
          [0, 0],
          [w, h],
        ])
        .translateExtent([
          [0, 0],
          [w, h],
        ]);
      // Keep the same view when the frame resizes.
      const ratio = lastWidth ? w / lastWidth : 1;
      const { k, x, y } = zoomTransform(element);
      lastWidth = w;
      setWidth(w);
      behavior.transform(
        selection,
        zoomIdentity.translate(x * ratio, y * ratio).scale(k),
      );
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      selection.on(".zoom", null);
      control.current = null;
    };
  }, []);
  const zoomBy = useCallback((factor: number | null) => {
    if (!control.current) return;
    const { behavior, element } = control.current;
    if (factor === null) behavior.transform(select(element), zoomIdentity);
    else behavior.scaleBy(select(element), factor);
  }, []);
  return { frame, width, transform, zoomBy };
}

/** The sharper outline once the map is zoomed in far enough. */
function useOutline(zoomedIn: boolean): Outline {
  const [outline, setOutline] = useState(COARSE);
  useEffect(() => {
    if (!zoomedIn || outline !== COARSE) return;
    let live = true;
    void loadFine().then((loaded) => live && setOutline(loaded));
    return () => {
      live = false;
    };
  }, [zoomedIn, outline]);
  return outline;
}

function contactCount(places: readonly ContactMapPlace[]): number {
  return places.reduce((sum, place) => sum + place.contacts.length, 0);
}

/** One dot's diameter in pixels: wider for more people, never a crowd. */
function dotSize(count: number): number {
  return count === 1 ? 10 : Math.min(36, Math.round(14 + 3 * Math.sqrt(count)));
}

/** The query's contacts on a world map, one dot per place. */
export function ContactsMap({
  query,
  filtered,
  onClearFilters,
  onOpen,
}: {
  query: ContactQuery;
  filtered: boolean;
  onClearFilters: () => void;
  onOpen: (id: string) => void;
}) {
  const t = useTranslations("App.Contacts.map");
  const tContacts = useTranslations("App.Contacts");
  const map = useContactMap(query);
  const { frame, width, transform, zoomBy } = useMapZoom();
  const { k, x, y } = transform;
  const outline = useOutline(k >= FINE_FROM);
  // Steps of a quarter zoom level, so clustering reruns on few zoom events.
  const level = Math.round(Math.log2(k) * 4) / 4;
  const clusters = useMemo(
    () =>
      map.data
        ? clusterPlaces(
            map.data.places,
            (MIN_GAP_PX * WIDTH) / width / 2 ** level,
            project,
          )
        : [],
    [map.data, width, level],
  );

  if (map.isPending)
    return (
      <div className="p-4" role="status">
        <span className="sr-only">{t("loading")}</span>
        <Skeleton className="w-full" style={ASPECT} />
      </div>
    );
  if (map.error)
    return (
      <EmptyState
        title={t("errorTitle")}
        description={coreErrorOf(map.error).message ?? t("error")}
        action={
          <Button variant="outline" onClick={() => void map.refetch()}>
            {t("retry")}
          </Button>
        }
      />
    );

  const { places, unplaced, pending, withoutLocation } = map.data;
  if (places.length === 0 && filtered && unplaced === 0 && pending === 0)
    return (
      <EmptyState
        icon={MapPin}
        title={tContacts("noMatchesTitle")}
        description={tContacts("noMatches")}
        action={
          <Button variant="outline" onClick={onClearFilters}>
            {tContacts("clearFilters")}
          </Button>
        }
      />
    );
  if (places.length === 0 && pending === 0)
    return (
      <EmptyState
        icon={MapPin}
        title={t("emptyTitle")}
        description={unplaced > 0 ? t("emptyUnplaced") : t("empty")}
      />
    );

  const placed = contactCount(places);
  const scale = width / WIDTH;
  return (
    <div className="flex flex-col">
      <div className="relative m-2 overflow-hidden md:m-4" style={ASPECT}>
        <div
          ref={frame}
          className="absolute inset-0 cursor-grab touch-none active:cursor-grabbing"
        >
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="absolute inset-0 size-full"
            aria-hidden
          >
            <g transform={`translate(${x / scale} ${y / scale}) scale(${k})`}>
              <path d={outline.land} className="fill-muted" />
              {k >= BORDERS_FROM ? (
                <path
                  d={outline.borders}
                  className="stroke-background fill-none"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
            </g>
          </svg>
          <ul aria-label={t("label")}>
            {clusters.map((cluster) => {
              const left = cluster.x * k + x / scale;
              const top = cluster.y * k + y / scale;
              if (left < 0 || left > WIDTH || top < 0 || top > HEIGHT)
                return null;
              return (
                <PlaceDot
                  key={`${cluster.x},${cluster.y}`}
                  cluster={cluster}
                  left={left}
                  top={top}
                  named={k >= NAMES_FROM}
                  onOpen={onOpen}
                />
              );
            })}
          </ul>
        </div>
        <div className="absolute end-2 bottom-2 flex flex-col gap-1">
          <Button
            variant="outline"
            size="icon"
            className="size-10 md:size-8"
            aria-label={t("zoomIn")}
            disabled={k >= MAX_ZOOM}
            onClick={() => zoomBy(2)}
          >
            <Plus />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-10 md:size-8"
            aria-label={t("zoomOut")}
            disabled={k <= 1}
            onClick={() => zoomBy(0.5)}
          >
            <Minus />
          </Button>
          {k > 1 ? (
            <Button
              variant="outline"
              size="icon"
              className="size-10 md:size-8"
              aria-label={t("resetZoom")}
              onClick={() => zoomBy(null)}
            >
              <Maximize2 />
            </Button>
          ) : null}
        </div>
      </div>
      <p className="text-muted-foreground border-border border-t px-3 py-2 text-xs">
        {[
          t("placed", { count: placed }),
          pending > 0 ? t("pending", { count: pending }) : null,
          unplaced > 0 ? t("unplaced", { count: unplaced }) : null,
          withoutLocation > 0
            ? t("withoutLocation", { count: withoutLocation })
            : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </div>
  );
}

interface Cluster {
  x: number;
  y: number;
  places: ContactMapPlace[];
}

/**
 * Places closer than `gap` map units share one dot, at the busiest one;
 * otherwise a dot would sit on its neighbour and take its clicks.
 */
export function clusterPlaces(
  places: readonly ContactMapPlace[],
  gap: number,
  project: (place: ContactMapPlace) => [number, number],
): Cluster[] {
  const clusters: Cluster[] = [];
  const busiestFirst = [...places].sort(
    (a, b) => b.contacts.length - a.contacts.length,
  );
  for (const place of busiestFirst) {
    const [x, y] = project(place);
    const near = clusters.find(
      (cluster) => Math.hypot(cluster.x - x, cluster.y - y) < gap,
    );
    if (near) near.places.push(place);
    else clusters.push({ x, y, places: [place] });
  }
  return clusters;
}

function project(place: ContactMapPlace): [number, number] {
  return projection([place.longitude, place.latitude]) ?? [0, 0];
}

function PlaceDot({
  cluster,
  left,
  top,
  named,
  onOpen,
}: {
  cluster: Cluster;
  /** Where the dot sits, in map units of the zoomed view. */
  left: number;
  top: number;
  /** Shows the place's name beside the dot. */
  named: boolean;
  onOpen: (id: string) => void;
}) {
  const t = useTranslations("App.Contacts.map");
  const [first, ...others] = cluster.places;
  const count = contactCount(cluster.places);
  const size = dotSize(count);
  const label =
    others.length === 0
      ? first.label
      : t("nearby", { place: first.label, others: others.length });
  return (
    <li
      className="absolute -translate-x-1/2 -translate-y-1/2"
      style={{
        left: `${(left / WIDTH) * 100}%`,
        top: `${(top / HEIGHT) * 100}%`,
      }}
    >
      {named ? (
        <span className="bg-background text-foreground pointer-events-none absolute start-full top-1/2 ms-1 -translate-y-1/2 rounded px-1 text-2xs whitespace-nowrap">
          {first.label.split(",")[0]}
          {others.length > 0 ? ` +${others.length}` : null}
        </span>
      ) : null}
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t("place", { place: label, count })}
            className="group flex min-h-6 min-w-6 cursor-pointer items-center justify-center rounded-full focus-visible:outline-none"
          >
            <span
              className="bg-foreground text-background ring-background group-hover:ring-foreground group-focus-visible:ring-foreground flex items-center justify-center rounded-full text-2xs font-medium ring-2"
              style={{ width: size, height: size }}
            >
              {count > 1 ? count : null}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="center">
          <div className="max-h-80 overflow-y-auto">
            {cluster.places.map((place) => (
              <section
                key={`${place.latitude},${place.longitude}`}
                className="border-border border-b last:border-b-0"
              >
                <div className="px-3 pt-2 pb-1">
                  <p className="truncate text-sm font-medium">{place.label}</p>
                  <p className="text-muted-foreground text-xs">
                    {t("people", { count: place.contacts.length })}
                  </p>
                </div>
                <ul className="p-1">
                  {place.contacts.map((contact) => (
                    <li key={contact.id}>
                      <button
                        type="button"
                        onClick={() => onOpen(contact.id)}
                        className="hover:bg-quinary focus-visible:bg-quinary flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-start focus-visible:outline-none"
                      >
                        <ContactAvatar
                          name={contact.name}
                          src={contact.avatarUrl}
                          kind={contact.kind}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">
                            {contact.name}
                          </span>
                          {contact.organization ? (
                            <span className="text-muted-foreground block truncate text-xs">
                              {contact.organization}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </li>
  );
}
