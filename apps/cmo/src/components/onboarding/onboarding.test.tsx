import type { CmoOverview } from "@sokosumi/core-client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { planWeeks } from "../../lib/calendar";
import { cmoStrategyVersion } from "../../test-fixtures/cmo";
import {
  asking,
  brain,
  draft,
  hex,
  mappedBrain,
  richMedia,
  sevenPlan,
  strategy,
  work,
} from "../../test-fixtures/onboarding";
import { showcaseEntries } from "../showcases";
import { BrandStep, brandTiles } from "./brand-step";
import { firstPost } from "./networks";
import { PlanReview, planTabAfterKey } from "./plan-step";
import { MonthPanel } from "./plan-tabs";


const noop = async () => {};
const plan = (
  overview: CmoOverview,
  initialTab?: "plan" | "month" | "results",
) =>
  renderToStaticMarkup(
    <PlanReview
      overview={overview}
      initialTab={initialTab}
      onConnectMeasurement={async () => ({ url: null, error: null })}
    />,
  );

describe("Brand Brain tiles", () => {
  const render = (overview: CmoOverview) =>
    renderToStaticMarkup(
      <BrandStep
        overview={overview}
        messages={[]}
        onCorrect={noop}
        onSave={noop}
      />,
    );

  it("marks a tile the founder fixed, and one Cuso is still fixing", () => {
    const fix = (fixed: boolean) => ({
      answer: "Rocket Pro, from 19 dollars a month.",
      findings: [],
      openQuestions: [],
      fix: { note: "From 19 dollars.", at: "2026-10-05T09:00:00Z", fixed },
    });
    const fixed = render(
      draft({ brandBrain: { ...brain, profile: { offer: fix(true) } } }),
    );
    expect(fixed).toContain("Fixed by you");
    expect(fixed).not.toContain("Cuso is fixing this");
    const fixing = render(
      draft({ brandBrain: { ...brain, profile: { offer: fix(false) } } }),
    );
    expect(fixing).toContain("Cuso is fixing this");
    expect(render(draft())).not.toContain("Fixed by you");
  });

  it("shows only the tiles that have data, in order", () => {
    const html = render(draft());
    const order = [
      "What you sell",
      "Who buys",
      "Your voice",
      "Competitors",
      "Profiles",
    ].map((label) => html.indexOf(`>${label}<`));
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // No marketing-today data, so no such tile.
    expect(html).not.toContain(">Marketing today<");
    expect(html).toContain("Rocket Pro");
  });

  it("keeps tile values short and puts the long text in the detail", () => {
    const html = render(
      draft({
        brandBrain: {
          ...brain,
          products: [],
          offers: [
            { name: "Free", what: "Everything for one site", price: "$0" },
            { name: "Team", what: "More seats", price: "$99" },
          ],
          competitors: [{ name: "Whaaat AI" }, { name: "Moonshot" }],
          marketingToday: {
            summary:
              "The site features product, use-case, pricing, and comparison pages; the blog is quiet.",
            channels: [
              { name: "x", basis: "estimated" },
              { name: "LinkedIn", basis: "measured" },
            ],
          },
        },
      }),
    );
    expect(html).toContain(">2 offers<");
    expect(html).toContain(">2 compared<");
    expect(html).toContain("Whaaat AI, Moonshot");
    expect(html).toContain(">X and LinkedIn<");
    expect(html).toContain("The site features product, use-case, pricing");
  });
});

describe("The plan, read-only", () => {
  it("strikes a patched entry through beside its new words, and leaves the rest", () => {
    const [first, second, third] = strategy.calendar;
    const html = renderToStaticMarkup(
      <MonthPanel
        strategy={{
          ...strategy,
          calendar: [
            first!,
            { ...second!, title: "Launch week", hook: undefined },
            { ...third!, status: "skipped" },
          ],
          patched: [
            { id: second!.id, was: second! },
            { id: third!.id, was: third! },
          ],
        }}
        overview={asking()}
        writing={false}
        onOpen={() => {}}
      />,
    );
    expect(html).toContain('<del class="ob-was">Three, two, one.</del>');
    expect(html).toContain("Launch week");
    expect(html).toContain('<del class="ob-was">October launches</del>');
    // Untouched entries render as before, with nothing struck.
    expect(html).toContain("We built a rocket in a garage.");
    // Each struck entry shows in Up first and on its day; no other is struck.
    expect(html.match(/<del/g)).toHaveLength(4);
  });

  it("makes the short goal the one H1, with the long sentence under it", () => {
    const sentence =
      "We'll reach marketing leads with recurring backlogs, show named specialists turning briefs into finished files, and invite them to try the Free plan.";
    const base = draft();
    const html = plan({
      ...base,
      strategy: {
        ...strategy,
        objective: { outcome: "More marketing teams starting Free" },
        idea: {
          who: "Leads",
          position: "Specialists",
          attract: "Demos",
          offer: "Free",
          sentence,
        },
      },
    });
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toMatch(
      /<h1 class="ob-goal-headline">More marketing teams starting Free<\/h1>/,
    );
    expect(html).toContain(
      `<p class="ob-goal-statement">${sentence.replaceAll("'", "&#x27;")}</p>`,
    );
  });

  it("shows what stops people buying, the other plans and the rest closed", () => {
    const base = draft();
    const html = plan({
      ...base,
      strategy: {
        ...strategy,
        barrier: { kind: "trust", text: "Teams fear vendors that go quiet." },
        alternatives: [
          { sentence: "Lead with price.", why: "Fast, but fickle." },
        ],
        ladder: { core: { what: "Rocket Pro" } },
        why: "Founders read LinkedIn.",
      },
    });
    expect(html).toContain("What stops people buying");
    expect(html).toContain("Teams fear vendors that go quiet.");
    expect(html).toContain("I also looked at 1 other plan.");
    expect(html).toContain("Compare them");
    expect(html).not.toContain("Lead with price.");
    expect(html).toMatch(/<details class="ob-more">/);
    expect(html).toContain("Everything in the plan");
    expect(html).toContain("Why this plan");
  });

  it("is read-only once approved: answers, pace and budget as text, no change", () => {
    const base = draft(cmoStrategyVersion(new Date()));
    const html = renderToStaticMarkup(
      <PlanReview
        overview={{
          ...base,
          strategy: {
            ...strategy,
            pace: { level: "active", why: "One a day", perWeek: 7 },
            ads: {
              monthly: 200,
              currency: "EUR",
              expect: "Some sales",
              without: "Organic only",
            },
            questions: [
              {
                id: "q",
                question: "Do you ship every month?",
                statement: "They ship.",
                answer: "no",
                note: "Every quarter",
              },
            ],
          },
        }}
        onConnectMeasurement={async () => ({ url: null, error: null })}
      />,
    );
    expect(html).toContain("Do you ship every month?");
    expect(html).toContain("Every quarter");
    expect(html).toContain("Pace:");
    expect(html).toContain("about one a day");
    expect(html).toContain("€200 a month for ads");
    for (const live of [
      "Ask for a change",
      "Approve plan",
      "Update plan",
      ">All-in<",
      ">Change<",
      ">Yes<",
    ]) {
      expect(html).not.toContain(live);
    }
  });
});

describe("plan tab keyboard", () => {
  it("moves left and right around the three tabs, and jumps to the ends", () => {
    expect(planTabAfterKey({ key: "ArrowRight" }, 0)).toBe(1);
    expect(planTabAfterKey({ key: "ArrowRight" }, 2)).toBe(0);
    expect(planTabAfterKey({ key: "ArrowLeft" }, 0)).toBe(2);
    expect(planTabAfterKey({ key: "Home" }, 2)).toBe(0);
    expect(planTabAfterKey({ key: "End" }, 0)).toBe(2);
    expect(planTabAfterKey({ key: "Enter" }, 0)).toBeNull();
  });
});

describe("strategy helpers the screens build on", () => {
  it("lays four Monday-first weeks out from the first entry", () => {
    const weeks = planWeeks(strategy.calendar);
    expect(weeks).toHaveLength(4);
    expect(weeks[0]?.days[0]).toBe("2026-10-05");
    expect(weeks[3]?.days[6]).toBe("2026-11-01");
  });

  it("groups pieces into account previews, written drafts first", () => {
    const groups = showcaseEntries(strategy);
    expect(groups.get("linkedin")?.map((entry) => entry.id)).toEqual(["a"]);
    expect(groups.get("x")?.map((entry) => entry.id)).toEqual(["b"]);
    expect(groups.get("newsletter")?.map((entry) => entry.id)).toEqual(["c"]);
  });
});

describe("first post on Your month", () => {
  const connected = new Set(["linkedin"]);
  const calendar = [
    { date: "2026-10-06", time: "07:30", channel: "linkedin" },
    { date: "2026-10-06", time: "09:00", channel: "linkedin" },
    { date: "2026-10-06", time: "08:00", channel: "instagram" },
  ];

  it("is the next post still to come on a connected network, in local time", () => {
    // 08:00 on 6 Oct where the founder is: 07:30 already went out.
    const now = new Date(2026, 9, 6, 8, 0);
    expect(firstPost(calendar, connected, now)).toEqual({
      when: "Tuesday 6 Oct, 09:00",
      channel: "linkedin",
    });
  });

  it("is none once every post on a connected network went out", () => {
    expect(
      firstPost(calendar, connected, new Date(2026, 9, 6, 10, 0)),
    ).toBeNull();
  });
});

describe("Competitor map", () => {
  type Brain = NonNullable<CmoOverview["brandBrain"]>;
  const competitors = (brandBrain: Brain) =>
    renderToStaticMarkup(
      <>
        {
          brandTiles(brandBrain, noop, richMedia).find(
            (tile) => tile.id === "competitors",
          )?.body
        }
      </>,
    );
  const dot = (html: string, name: string) =>
    new RegExp(`<button[^>]*class="ob-map-dot[^"]*"[^>]*>${name}(?:<|$)`).exec(
      html,
    )?.[0];

  it("places each player at its x and y on the two named axes", () => {
    const html = competitors(mappedBrain);
    expect(html).toContain("ob-map-plot");
    expect(dot(html, "Moonshot")).toContain("left:40%;bottom:60%");
    expect(dot(html, "Build it in house")).toContain("left:15%;bottom:20%");
    expect(html).toContain("↑ Done for you");
    expect(html).toContain("Do it yourself");
    expect(html).toContain("For one person");
    expect(html).toContain("For whole teams →");
  });

  it("marks the founder as the one larger button among the dots", () => {
    const html = competitors(mappedBrain);
    expect(html.match(/ob-map-dot you/g)).toHaveLength(1);
    expect(html).toMatch(
      /<button type="button" class="ob-map-dot you"[^>]*>Acme<span class="ob-sr">, you</,
    );
    expect(dot(html, "Acme")).toContain("ob-map-dot you");
  });

  it("puts a label left of its dot past x 75", () => {
    const html = competitors(mappedBrain);
    expect(dot(html, "Orbit Labs")).toContain("ob-map-dot flip");
    expect(dot(html, "Moonshot")).not.toContain("flip");
  });

  it("names every rival as a row the map can pick, above nothing but the map", () => {
    const html = competitors(mappedBrain);
    expect(html.indexOf("ob-map-plot")).toBeLessThan(html.indexOf("ob-rival"));
    for (const name of ["Moonshot", "Orbit Labs", "Build it"]) {
      expect(html).toMatch(
        new RegExp(`<button[^>]*class="ob-rival"[^>]*aria-pressed="false"`),
      );
      expect(html).toContain(`>${name}<`);
    }
    // The row still leads to the rival's site.
    expect(html).toContain('href="https://moonshot.io"');
  });

  it("draws no plot without a map, or with fewer than two players", () => {
    const { map, ...reveal } = mappedBrain.reveal as NonNullable<
      Brain["reveal"]
    >;
    const none = competitors({ ...mappedBrain, reveal });
    expect(none).not.toContain("ob-map");
    expect(none).toContain("bm-rivals");
    const alone = competitors({
      ...mappedBrain,
      reveal: {
        ...reveal,
        map: {
          ...(map as NonNullable<typeof map>),
          players: [{ name: "Acme", x: 50, y: 50, you: true }],
        },
      },
    });
    expect(alone).not.toContain("ob-map");
  });
});

describe("Account previews", () => {
  const visual: CmoOverview["brandVisual"] = {
    logoUrl: null,
    colors: ["1b1b1b", "ff6a00", "0055ff"].map(hex),
    fonts: ["Inter"],
    siteName: "Acme",
    designMdUrl: null,
    images: [],
  };
  const LABELS = [
    "Your X profile",
    "Your LinkedIn feed",
    "Your Instagram grid",
    "Your Facebook page",
    "Your ad on Facebook and Instagram",
    "Your ad on Google",
    "Your newsletter",
  ];
  const month = (overview: CmoOverview) => plan(overview, "month");

  it("shows one frame per channel the plan uses, in October's order, under week one", () => {
    const html = month(draft({ strategy: sevenPlan, brandVisual: visual }));
    const heading = html.indexOf("What your accounts will look like");
    expect(heading).toBeGreaterThan(html.indexOf("Week 1"));
    const at = LABELS.map((label) => html.indexOf(label));
    expect(at.every((index) => index > heading)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(html.match(/ob-showcase-label/g)).toHaveLength(7);
    expect(html).not.toContain("Your article in Google");
  });

  it("leaves out skipped pieces, and a channel with only skipped pieces", () => {
    const html = month(
      draft({
        strategy: {
          ...sevenPlan,
          calendar: sevenPlan.calendar.map((entry) =>
            entry.channel === "instagram"
              ? { ...entry, status: "skipped" as const }
              : entry,
          ),
        },
        brandVisual: visual,
      }),
    );
    expect(html.match(/ob-showcase-label/g)).toHaveLength(6);
    expect(html).not.toContain("Your Instagram grid");
  });

  it("leaves out the channels the plan does not use", () => {
    const html = month(draft({ brandVisual: visual }));
    expect(html.match(/ob-showcase-label/g)).toHaveLength(3);
    expect(html).toContain("Your LinkedIn feed");
    expect(html).not.toContain("Your Instagram grid");
    expect(html).not.toContain("Your ad on Google");
  });

  it("colours the frames with the brand's first two real colours, never Iris", () => {
    const html = month(draft({ strategy: sevenPlan, brandVisual: visual }));
    expect(html).toContain("--brand:#ff6a00;--brand-2:#0055ff");
    const section = html.slice(html.indexOf("ob-showcases"));
    expect(section).not.toContain("--primary");
  });

  it("holds an unwritten ad's place while the plan writes", () => {
    const strategyWork = work("strategy");
    const writing = month(
      draft({ strategy: sevenPlan, brandVisual: visual, work: strategyWork }),
    );
    expect(writing.match(/Writing this ad/g)).toHaveLength(1);
    expect(writing).toContain("Rockets for Teams · Ship on Time");
    const written = month(draft({ strategy: sevenPlan, brandVisual: visual }));
    expect(written).not.toContain("Writing this ad");
  });

  it("replaces the hidden phone feeds", () => {
    const html = plan(draft({ strategy: sevenPlan }));
    expect(html).not.toContain("Where it shows up");
  });
});
