import { describe, expect, it, vi } from "vitest";
import { coreLogEvents, expectCoreLog } from "@/test/core-log";

const prismaMock = vi.hoisted(() => ({
  contact: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
  geocodedPlace: { findMany: vi.fn(), createMany: vi.fn() },
}));
vi.mock("@/lib/db/prisma", () => ({ default: prismaMock }));
vi.mock("@/services/contacts.service", () => ({
  contactListWhere: vi.fn(async () => ({})),
}));

import {
  contactMap,
  normalizeLocation,
  parseGeocodeAnswer,
} from "./contact-map.service";

describe("normalizeLocation", () => {
  it("treats case and spacing as one place", () => {
    expect(normalizeLocation("  Zurich,   Switzerland ")).toBe(
      "zurich, switzerland",
    );
    expect(normalizeLocation("   ")).toBe("");
  });
});

describe("parseGeocodeAnswer", () => {
  it("puts each answer at its line and leaves the rest null", () => {
    const text =
      'Sure: {"places": [{"i": 2, "label": "Berlin, Germany", "lat": 52.52, "lng": 13.4}, {"i": 9, "label": "Nowhere", "lat": 0, "lng": 0}, {"i": 1, "label": "Bad", "lat": 120, "lng": 0}]}';
    expect(parseGeocodeAnswer(text, 3)).toEqual([
      null,
      { label: "Berlin, Germany", latitude: 52.52, longitude: 13.4 },
      null,
    ]);
  });

  it("gives null for an answer that is not the JSON asked for", () => {
    expect(parseGeocodeAnswer("I cannot help", 2)).toBeNull();
    expect(parseGeocodeAnswer('{"places": "none"}', 2)).toBeNull();
  });
});

describe("contactMap", () => {
  it("logs a failed place lookup without the places it asked for", async () => {
    const warnings = expectCoreLog(
      "warn",
      "Could not look up contact places for the map",
    );
    prismaMock.contact.findMany.mockResolvedValue([
      {
        id: "contact-1",
        name: "Pat",
        kind: "PERSON",
        organization: null,
        avatarUrl: null,
        location: "SECRET-STREET 1, Zurich",
      },
    ]);
    prismaMock.contact.count.mockResolvedValue(0);
    prismaMock.geocodedPlace.findMany.mockResolvedValue([]);
    const scheduled: Promise<unknown>[] = [];

    const map = await contactMap(
      { workspaceId: "workspace-1", userId: "user-1", sokoBotId: null },
      { filter: {} },
      {
        geocode: async (places) => {
          throw new Error(`No answer for ${places.join(", ")}`);
        },
        schedule: (work) => scheduled.push(work),
      },
    );
    await Promise.all(scheduled);

    expect(map.pending).toBe(1);
    expect(warnings[0]).toMatchObject({
      why: "The geocoding call or saving its answers failed",
    });
    expect(warnings[0]?.event).toMatchObject({
      places: 1,
      failure: { errorName: "Error" },
    });
    expect(JSON.stringify(coreLogEvents())).not.toMatch(/SECRET-STREET/i);
  });
});
