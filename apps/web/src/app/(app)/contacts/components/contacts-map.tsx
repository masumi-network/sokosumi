"use client";
import type { ContactMapPlace } from "@sokosumi/core-client";
import { geoNaturalEarth1, geoPath } from "d3-geo";
import { MapPin } from "lucide-react";
import { useTranslations } from "next-intl";
import { type RefCallback, useCallback, useState } from "react";
import { feature } from "topojson-client";
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

const ANTARCTICA = "010";
const atlas = countries as unknown as Parameters<typeof feature>[0];
const all = feature(atlas, atlas.objects.countries);
// Antarctica holds nobody's contacts and would take a third of the height.
const land = {
  type: "FeatureCollection" as const,
  features: ("features" in all ? all.features : [all]).filter(
    (country) => country.id !== ANTARCTICA,
  ),
};
const WIDTH = 960;
const projection = geoNaturalEarth1().fitWidth(WIDTH - 16, land);
const path = geoPath(projection);
const [[, top], [, bottom]] = path.bounds(land);
const HEIGHT = Math.ceil(bottom - top) + 16;
projection.translate([
  projection.translate()[0] + 8,
  projection.translate()[1] - top + 8,
]);
const LAND_PATH = path(land) ?? undefined;
const ASPECT = { aspectRatio: `${WIDTH} / ${HEIGHT}` };

/** Dots closer than this on screen merge, so each stays clickable. */
const MIN_GAP_PX = 26;

/** An element's rendered width, kept current as it resizes. */
function useWidth(): [RefCallback<HTMLElement>, number] {
  const [width, setWidth] = useState(WIDTH);
  const ref = useCallback((element: HTMLElement | null) => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width || WIDTH),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
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
  const [frame, width] = useWidth();

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

  const { places, unplaced, withoutLocation } = map.data;
  if (places.length === 0 && filtered && unplaced === 0)
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
  if (places.length === 0)
    return (
      <EmptyState
        icon={MapPin}
        title={t("emptyTitle")}
        description={unplaced > 0 ? t("emptyUnplaced") : t("empty")}
      />
    );

  const placed = contactCount(places);
  return (
    <div className="flex flex-col">
      <div ref={frame} className="relative m-2 md:m-4" style={ASPECT}>
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="absolute inset-0 size-full"
          aria-hidden
        >
          <path d={LAND_PATH} className="fill-muted" />
        </svg>
        <ul aria-label={t("label")}>
          {clusterPlaces(places, (MIN_GAP_PX * WIDTH) / width, project).map(
            (cluster) => (
              <PlaceDot
                key={`${cluster.x},${cluster.y}`}
                cluster={cluster}
                onOpen={onOpen}
              />
            ),
          )}
        </ul>
      </div>
      <p className="text-muted-foreground border-border border-t px-3 py-2 text-xs">
        {[
          t("placed", { count: placed }),
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
  onOpen,
}: {
  cluster: Cluster;
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
        left: `${(cluster.x / WIDTH) * 100}%`,
        top: `${(cluster.y / HEIGHT) * 100}%`,
      }}
    >
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
