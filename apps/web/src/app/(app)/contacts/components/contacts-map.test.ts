import type { ContactMapPlace } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import { clusterPlaces } from "./contacts-map";

function place(label: string, x: number, people: number): ContactMapPlace {
  return {
    label,
    latitude: 0,
    longitude: x,
    contacts: Array.from({ length: people }, (_, index) => ({
      id: `${label}-${index}`,
      name: label,
      kind: "PERSON",
      organization: null,
      avatarUrl: null,
    })),
  };
}

describe("clusterPlaces", () => {
  it("puts neighbours on the busiest one's dot and keeps far places apart", () => {
    const clusters = clusterPlaces(
      [place("Milan", 12, 1), place("Zurich", 0, 2), place("Tokyo", 500, 1)],
      20,
      (item) => [item.longitude, item.latitude],
    );
    expect(
      clusters.map((cluster) => ({
        x: cluster.x,
        places: cluster.places.map((item) => item.label),
      })),
    ).toEqual([
      { x: 0, places: ["Zurich", "Milan"] },
      { x: 500, places: ["Tokyo"] },
    ]);
  });
});
