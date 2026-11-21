import { describe, expect, it } from "vitest";
import {
  cmoOverview,
  cmoStrategy,
  cmoStrategyVersion,
} from "../test-fixtures/cmo";
import {
  dayIn,
  greeting,
  monthEntries,
  monthProgress,
  needsYou,
  waitingLine,
  weekOf,
} from "./today";

const approved = cmoStrategyVersion(new Date("2026-10-01T09:00:00Z"));

describe("needsYou", () => {
  it("lists a strategy to approve, posts to approve and a network posts wait for", () => {
    const items = needsYou(
      cmoOverview({
        drafts: [
          {
            id: "d1",
            provider: "x",
            text: "Hello",
            status: "NEEDS_APPROVAL",
            revision: 0,
            scheduledAt: null,
            publishedUrl: null,
            media: [],
          },
        ],
      }),
    );
    expect(items.map((item) => [item.id, item.view])).toEqual([
      ["strategy", "strategy"],
      ["drafts", "calendar"],
      ["connect", "channels"],
    ]);
    expect(items[1]?.title).toBe("1 post waits for your OK");
    expect(items[2]?.title).toBe("Connect LinkedIn");
    expect(items[2]?.detail).toBe("1 post is written and waits for it.");
  });

  it("asks once for every network posts wait for, so the list stays short", () => {
    const overview = cmoOverview();
    const strategy = overview.strategy;
    if (!strategy) throw new Error("fixture has a strategy");
    const [first] = strategy.calendar;
    if (!first) throw new Error("fixture has an entry");
    const waiting = ["x", "instagram", "facebook", "x"].map((channel, n) => ({
      ...first,
      id: `w${n}`,
      channel,
      status: "draft" as const,
    }));
    const items = needsYou({
      ...overview,
      strategy: { ...strategy, calendar: [first, ...waiting] },
    }).filter((item) => item.view === "channels");
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe("Connect LinkedIn, X, Instagram and Facebook");
    expect(items[0]?.detail).toBe("5 posts are written and wait for them.");
    expect(items[0]?.action).toBe("Open Channels");
  });

  it("is empty once everything is approved and connected", () => {
    expect(
      needsYou(
        cmoOverview({
          ...approved,
          channels: [
            {
              id: "c1",
              provider: "linkedin",
              status: "ACTIVE",
              accountName: "acme",
            } as never,
          ],
        }),
      ),
    ).toEqual([]);
  });

  it("puts running out of credits first", () => {
    const overview = cmoOverview(approved);
    const items = needsYou({
      ...overview,
      billing: { ...overview.billing, availableCredits: 0 },
    });
    expect(items[0]?.id).toBe("credits");
    expect(items[0]?.view).toBe("settings");
  });
});

describe("the week", () => {
  it("runs Monday to Sunday around the day", () => {
    expect(weekOf("2026-11-19")).toEqual([
      "2026-11-16",
      "2026-11-17",
      "2026-11-18",
      "2026-11-19",
      "2026-11-20",
      "2026-11-21",
      "2026-11-22",
    ]);
    expect(weekOf("2026-11-16")[0]).toBe("2026-11-16");
    expect(weekOf("2026-11-22")[0]).toBe("2026-11-16");
  });

  it("takes the day in Cuso's time zone, not the server's", () => {
    const late = new Date("2026-11-19T23:30:00Z");
    expect(dayIn("Europe/Berlin", late)).toBe("2026-11-20");
    expect(dayIn("America/Los_Angeles", late)).toBe("2026-11-19");
    expect(dayIn("Not/AZone", late)).toBe("2026-11-19");
  });

  it("greets by the hour where Cuso works", () => {
    const at = new Date("2026-11-19T08:00:00Z");
    expect(greeting("Europe/Berlin", at)).toBe("Good morning");
    // Midnight in Los Angeles: no "Good evening" after the day turned.
    expect(greeting("America/Los_Angeles", at)).toBe("Hello");
    expect(
      greeting("America/Los_Angeles", new Date("2026-11-20T09:55:00Z")),
    ).toBe("Hello");
    expect(
      greeting("America/Los_Angeles", new Date("2026-11-20T04:00:00Z")),
    ).toBe("Good evening");
  });

  it("says in one line how many posts wait, for which networks", () => {
    const post = (id: string, channel: string) => ({
      id,
      date: "2026-11-21",
      channel,
      title: id,
      format: "post",
      status: "draft" as const,
      draft: "Words",
    });
    const overview = cmoOverview({
      ...cmoStrategyVersion(new Date("2026-11-02T09:00:00Z")),
      strategy: {
        ...cmoStrategy,
        calendar: [
          post("a", "youtube"),
          post("b", "instagram"),
          post("c", "instagram"),
          post("d", "tiktok"),
        ],
      },
      channels: [],
    });
    expect(waitingLine(overview)).toBe(
      "4 posts wait for YouTube, Instagram and TikTok.",
    );
    expect(waitingLine(cmoOverview({ strategy: null }))).toBeNull();
  });
});

it("counts the month by where each post stands", () => {
  const entry = (status: "idea" | "draft" | "scheduled" | "published") => ({
    id: status,
    date: "2026-11-02",
    channel: "x",
    title: status,
    format: "post",
    status,
  });
  expect(
    monthProgress([
      entry("published"),
      entry("published"),
      entry("scheduled"),
      entry("draft"),
      entry("idea"),
      {
        ...entry("idea"),
        id: "ad",
        channel: "google_ads",
        format: "search ad",
      },
    ]),
  ).toEqual({ out: 2, scheduled: 1, written: 1, planned: 1, total: 5 });
});

it("leaves out the posts the plan bought does not make, as the Calendar does", () => {
  const overview = cmoOverview();
  const ids = (overview.strategy?.calendar ?? []).map((entry) => entry.id);
  const [beyond, ...made] = ids;
  if (!beyond) throw new Error("fixture has an entry");
  const month = monthEntries({
    ...overview,
    production: { ...overview.production, beyondPlan: [beyond] },
  });
  expect(month.map((entry) => entry.id).sort()).toEqual(made.sort());
});
