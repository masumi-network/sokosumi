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
  monthMade,
  monthProgress,
  needsYou,
  todayLine,
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
  ).toEqual({
    out: 2,
    scheduled: 1,
    written: 1,
    notSent: 0,
    planned: 1,
    total: 5,
  });
});

it("counts a post that did not go out on its own and asks the owner to look", () => {
  const overview = cmoOverview();
  const calendar = overview.strategy?.calendar ?? [];
  const [first, ...rest] = calendar;
  if (!first) throw new Error("fixture has an entry");
  const failed = {
    ...first,
    status: "draft" as const,
    notSent: "LinkedIn refused it.",
  };
  const strategy = overview.strategy
    ? { ...overview.strategy, calendar: [failed, ...rest] }
    : null;
  const withFailed = { ...overview, strategy, approvedStrategy: strategy };
  expect(monthProgress(monthEntries(withFailed)).notSent).toBe(1);
  expect(needsYou(withFailed)).toContainEqual({
    id: "not-sent",
    title: "1 post didn't go out",
    detail: "LinkedIn refused it.",
    action: "See post",
    view: "calendar",
    entryId: first.id,
  });
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

it("counts the month once, as it goes out, whatever Core's run still makes", () => {
  const overview = cmoOverview();
  const calendar = overview.strategy?.calendar ?? [];
  const [first] = calendar;
  if (!first) throw new Error("fixture has an entry");
  const entry = (id: string, status: "idea" | "draft" | "scheduled") => ({
    ...first,
    id,
    status,
    draft: status === "idea" ? undefined : "Words",
  });
  const strategy = overview.strategy
    ? {
        ...overview.strategy,
        calendar: [
          entry("out", "scheduled"),
          entry("written", "draft"),
          entry("coming", "idea"),
          entry("beyond", "scheduled"),
        ],
      }
    : null;
  expect(
    monthMade(
      {
        ...overview,
        strategy,
        approvedStrategy: strategy,
        production: {
          ...overview.production,
          ready: 8,
          total: 11,
          beyondPlan: ["beyond"],
        },
      },
      new Date(`${first.date}T00:00:00Z`),
    ),
  ).toEqual({ ready: 2, total: 3 });
});

it("leaves out a post whose day passed before it was made: it never goes out", () => {
  // entry.fyi, 2026-11-23: three X posts of 22 Nov read "To make" all month.
  const overview = cmoOverview({ ...approved });
  const [first] = overview.strategy?.calendar ?? [];
  if (!first) throw new Error("fixture has an entry");
  const strategy = overview.strategy && {
    ...overview.strategy,
    calendar: [
      { ...first, id: "past", date: "2026-11-22", status: "idea" as const },
      {
        ...first,
        id: "sent",
        date: "2026-11-22",
        status: "published" as const,
      },
      { ...first, id: "next", date: "2026-11-24", status: "idea" as const },
    ],
  };
  const month = { ...overview, strategy, approvedStrategy: strategy };
  const now = new Date("2026-11-23T08:00:00Z");
  expect(monthEntries(month, now).map((entry) => entry.id)).toEqual([
    "sent",
    "next",
  ]);
  expect(monthMade(month, now)).toEqual({ ready: 1, total: 2 });
});

it("leaves a post X paused out of Needs you: it is still scheduled, and Core retries it", () => {
  const overview = cmoOverview();
  const [first, ...rest] = overview.strategy?.calendar ?? [];
  if (!first) throw new Error("fixture has an entry");
  const paused = {
    ...first,
    status: "scheduled" as const,
    notSent: "X paused our posting for now; Cuso will try again.",
  };
  const strategy = overview.strategy
    ? { ...overview.strategy, calendar: [paused, ...rest] }
    : null;
  const held = { ...overview, strategy, approvedStrategy: strategy };
  expect(needsYou(held).map((item) => item.id)).not.toContain("not-sent");
  expect(monthProgress(monthEntries(held))).toMatchObject({
    notSent: 0,
    scheduled: 1,
  });
});

describe("todayLine", () => {
  const hired = cmoOverview({ ...approved });
  const made = monthMade(hired);
  const at = (state: (typeof hired)["production"]["state"]) => ({
    ...hired,
    production: { ...hired.production, state },
  });

  it("never says nothing needs doing while the month stopped half made", () => {
    const line = todayLine(at("stuck"), 0);
    expect(line).not.toMatch(/Nothing needs you|on its day/);
    expect(line).toBe(
      `I stopped making your month at ${made.ready} of ${made.total}. My last try made nothing new, so I try the rest again soon.`,
    );
  });

  it("says when a stopped month is tried again, in the owner's time", () => {
    const stopped = at("stuck");
    const line = todayLine(
      {
        ...stopped,
        timeZone: "Europe/Zurich",
        production: {
          ...stopped.production,
          retryAt: new Date(Date.now() + 60_000).toISOString(),
        },
      },
      0,
    );
    expect(line).toMatch(/so I try the rest again (tomorrow )?at \d\d:\d\d\.$/);
  });

  it("counts the month while a run is about to make the rest", () => {
    expect(todayLine(at("starting"), 0)).toBe(
      `I'm making your month: ${made.ready} of ${made.total} ready.`,
    );
  });

  it("says nothing needs the owner only once the month is made", () => {
    expect(todayLine(at("ready"), 0)).toBe(
      "Nothing needs you. Everything goes out on its day.",
    );
  });
});
