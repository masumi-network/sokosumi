import { describe, expect, it } from "vitest";
import { cmoOverview, cmoStrategyVersion } from "../test-fixtures/cmo";
import { dayIn, greeting, monthProgress, needsYou, weekOf } from "./today";

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
    expect(greeting("America/Los_Angeles", at)).toBe("Good evening");
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
    ]),
  ).toEqual({ out: 2, scheduled: 1, written: 1, planned: 1, total: 5 });
});
