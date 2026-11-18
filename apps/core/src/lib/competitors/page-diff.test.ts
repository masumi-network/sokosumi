import { describe, expect, it } from "vitest";

import {
  diffLines,
  lineKey,
  pageLines,
  pagePrices,
  priceMove,
  stableLines,
  withLinesAbove,
} from "./page-diff";

function page(body: string): string {
  return `<html><head><style>.a{color:red}</style><script>var x = "Pro $99";</script></head><body>${body}</body></html>`;
}

describe("pageLines", () => {
  it("keeps what a reader sees and drops scripts, styles and repeats", () => {
    const lines = pageLines(
      page(
        "<h1>Scheduling for teams</h1><p>Book meetings without the back and forth.</p><p>Book meetings without the back and forth.</p>",
      ),
    );
    expect(lines).toEqual([
      "Scheduling for teams",
      "Book meetings without the back and forth.",
    ]);
  });

  it("drops consent banners, legal footers and session links", () => {
    const lines = pageLines(
      page(
        "<div>We use cookies to improve your experience.</div><button>Accept all</button><h1>Coffee, roasted fresh</h1><a>Sign in</a><footer>© 2026 Blue Bottle Coffee Inc.</footer><p>All rights reserved.</p><p>Last updated November 3, 2026</p>",
      ),
    );
    expect(lines).toEqual(["Coffee, roasted fresh"]);
  });

  it("drops a line that is only a date or a counter", () => {
    const lines = pageLines(
      page("<p>November 17, 2026</p><p>12,431</p><h2>New: routing forms</h2>"),
    );
    expect(lines).toEqual(["New: routing forms"]);
  });
});

describe("lineKey", () => {
  it("reads the same across dates, clock times and relative times", () => {
    expect(lineKey("Webinar on Nov 12, 2026 at 5:00 pm")).toBe(
      lineKey("Webinar on Nov 19, 2026 at 6:30 pm"),
    );
    expect(lineKey("Posted 3 days ago")).toBe(lineKey("Posted 2 hours ago"));
    expect(lineKey("2026-11-10 release notes")).toBe(
      lineKey("2026-11-17 release notes"),
    );
  });

  it("reads the same when a counter ticks up", () => {
    expect(lineKey("Trusted by 10,432 teams")).toBe(
      lineKey("Trusted by 10,519 teams"),
    );
    expect(lineKey("Rated by 2.5M users")).toBe(lineKey("Rated by 2.6M users"));
  });

  it("keeps a price, so a new price is a new line", () => {
    expect(lineKey("Pro $12 per seat")).not.toBe(lineKey("Pro $10 per seat"));
    expect(lineKey("Teams 15 € / month")).not.toBe(
      lineKey("Teams 18 € / month"),
    );
  });

  it("keeps small numbers that are part of the offer", () => {
    expect(lineKey("Up to 5 calendars")).not.toBe(
      lineKey("Up to 10 calendars"),
    );
  });
});

describe("stableLines", () => {
  it("drops what only one of two reads of a page shows", () => {
    const first = ["Scheduling for teams", '"Saved us hours" - Ana, Acme'];
    const second = ["Scheduling for teams", '"Love it" - Ben, Globex'];
    expect(stableLines(first, second)).toEqual(["Scheduling for teams"]);
  });
});

describe("diffLines", () => {
  it("finds nothing when only dates, counters and order changed", () => {
    const before = [
      "Scheduling for teams",
      "Trusted by 10,432 teams",
      "Webinar on Nov 12, 2026",
    ];
    const after = [
      "Webinar on Nov 19, 2026",
      "Scheduling for teams",
      "Trusted by 10,519 teams",
    ];
    expect(diffLines(before, after)).toEqual({ added: [], removed: [] });
  });

  it("finds a new statement and a dropped one", () => {
    const diff = diffLines(
      ["Scheduling for teams", "Free for individuals"],
      ["Scheduling for teams", "Now with AI notetaker"],
    );
    expect(diff).toEqual({
      added: ["Now with AI notetaker"],
      removed: ["Free for individuals"],
    });
  });
});

describe("priceMove", () => {
  it("finds the price that moved, and only that one", () => {
    const before = ["Standard", "$10", "Teams", "$16", "Enterprise"];
    const after = ["Standard", "$12", "Teams", "$16", "Enterprise"];
    expect(priceMove(before, after)).toEqual({
      before: ["$10"],
      after: ["$12"],
    });
  });

  it("finds a price that is new or gone", () => {
    expect(priceMove(["Pro $10"], ["Pro $10", "Max $30"])).toEqual({
      before: [],
      after: ["$30"],
    });
    expect(priceMove(["Pro $10", "Max $30"], ["Pro $10"])).toEqual({
      before: ["$30"],
      after: [],
    });
  });

  it("counts a price as often as the page lists it", () => {
    expect(priceMove(["Basic $10", "Add-on $10"], ["Basic $10"])).toEqual({
      before: ["$10"],
      after: [],
    });
  });

  it("finds nothing when only the words around the prices changed", () => {
    expect(
      priceMove(
        ["Pro $12 per seat, billed yearly", "Teams 18 € / month"],
        ["Teams: 18€ a month", "Pro plan, $12 a seat"],
      ),
    ).toBeNull();
  });
});

describe("pagePrices", () => {
  it("leaves the sentence's punctuation off a price", () => {
    expect(pagePrices(["Basic is $120, Premium is $200."])).toEqual([
      "$120",
      "$200",
    ]);
  });

  it("reads prices written before and after the amount", () => {
    expect(
      pagePrices(["From $1,200 a year", "Team 18 € pro Monat", "CHF 49"]),
    ).toEqual(["$1,200", "18€", "CHF49"]);
  });
});

describe("withLinesAbove", () => {
  it("gives each line the two lines above it on the page", () => {
    const page = ["Plans", "Standard", "For individuals", "$12", "Teams"];
    expect(withLinesAbove(["$12", "Plans", "Not on the page"], page)).toEqual([
      { line: "$12", above: ["Standard", "For individuals"] },
      { line: "Plans", above: [] },
      { line: "Not on the page", above: [] },
    ]);
  });
});
