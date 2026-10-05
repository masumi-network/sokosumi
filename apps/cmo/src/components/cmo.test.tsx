import type { ChatRoomMessage, CmoOverview } from "@sokosumi/core-client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  calendarKind,
  entryReadiness,
  monthGrid,
  relativeDay,
} from "../lib/calendar";
import { toCusoMessages } from "../lib/chat-messages";
import { buildThread, cusoStatus } from "../lib/thread";
import {
  LearningCard,
  learningSteps,
  StrategyCard,
  UpdateCard,
} from "./app/cards";
import { renderInline } from "./app/cmo-app";
import { ChannelsPage, ResultsPage } from "./app/pages";
import { Onboarding } from "./onboarding";

const strategy: NonNullable<CmoOverview["strategy"]> = {
  month: "2026-10",
  summary: "Founder led LinkedIn posts that show the product working.",
  goals: ["More demo requests"],
  pillars: ["Product stories"],
  channels: [{ channel: "linkedin", cadence: "3 a week" }],
  calendar: [
    {
      id: "a",
      date: "2026-10-05",
      channel: "linkedin",
      title: "Why we built it",
      format: "post",
      status: "draft",
    },
  ],
  previews: [
    { kind: "post", channel: "linkedin", title: "Hello", body: "First post" },
    { kind: "ad", channel: "meta", title: "Try it", body: "Ad copy" },
  ],
};

function overview(patch: Partial<CmoOverview> = {}): CmoOverview {
  return {
    id: "cmo-1",
    businessName: "Acme",
    websiteUrl: "https://acme.io",
    goals: "More sales",
    organizationId: "org-1",
    organizationSlug: "acme",
    workspaceId: "ws-1",
    sokoBotId: "bot-1",
    projectId: "project-1",
    roomId: "room-1",
    botStatus: "IDLE",
    learning: "done",
    routines: [
      {
        key: "cmo-daily-run",
        name: "Daily marketing run",
        when: "Every day at 09:00",
        description: "Prepares what the calendar has due.",
        nextRunAt: null,
        timezone: "Europe/Berlin",
      },
    ],
    subscriptionActive: false,
    brandBrain: {
      summary: "Acme sells rockets.",
      voice: { tone: "Direct", do: [], dont: [], examples: [] },
      audience: ["Founders"],
      products: [],
      competitors: [],
      channels: [],
    },
    brandBrainUpdatedAt: new Date("2026-10-01T09:01:00Z"),
    strategy,
    strategyUpdatedAt: new Date("2026-10-01T09:02:00Z"),
    strategyApprovedAt: null,
    updates: [],
    channels: [],
    upNext: [],
    connectChannelUrl: "http://web/social?projectId=project-1",
    subscribeUrl: "http://web/billing",
    billing: { plan: null, subscriptionStatus: null, availableCredits: 40 },
    posts: { draft: 2, scheduled: 1, published: 0, failed: 0 },
    createdAt: new Date("2026-10-01T09:00:00Z"),
    ...patch,
  };
}

const noop = {
  approve: async () => {},
  revert: async () => {},
  retryLearning: async () => {},
  compose: () => {},
  open: () => {},
};

describe("Onboarding", () => {
  it("asks for the website and one main goal", () => {
    const html = renderToStaticMarkup(<Onboarding onboard={async () => {}} />);
    expect(html).toContain('name="websiteUrl"');
    expect(html).toContain('name="goals" value="More sales"');
    expect(html).toContain("Launch something");
  });
});

describe("calendar", () => {
  it("lays the month out Monday first", () => {
    const cells = monthGrid("2026-10", strategy.calendar);
    // 1 October 2026 is a Thursday: three blank cells first.
    expect(cells.slice(0, 3).every((cell) => cell.date === null)).toBe(true);
    expect(cells[3]?.date).toBe("2026-10-01");
    expect(
      cells.find((cell) => cell.date === "2026-10-05")?.entries,
    ).toHaveLength(1);
  });

  it("marks ads, newsletters and articles apart from posts", () => {
    expect(calendarKind({ format: "post", channel: "linkedin" })).toBe("post");
    expect(calendarKind({ format: "ad", channel: "meta" })).toBe("ad");
    expect(calendarKind({ format: "newsletter", channel: "email" })).toBe(
      "news",
    );
    expect(calendarKind({ format: "article", channel: "blog" })).toBe(
      "article",
    );
  });

  it("says why an entry is not executed yet", () => {
    expect(entryReadiness("linkedin", ["linkedin"])).toBe("ready");
    expect(entryReadiness("linkedin", [])).toBe("connect");
    expect(entryReadiness("website", ["linkedin"])).toBe("soon");
  });

  it("names nearby days", () => {
    expect(relativeDay("2026-10-05", "2026-10-05")).toBe("Today");
    expect(relativeDay("2026-10-06", "2026-10-05")).toBe("Tomorrow");
  });
});

describe("thread", () => {
  it("orders messages and cards by time", () => {
    const messages = toCusoMessages([
      {
        id: "m1",
        parentMessageId: null,
        deletedAt: null,
        content: "Plan is ready.",
        createdAt: new Date("2026-10-01T09:03:00Z"),
        sender: { type: "sokoBot", sokoBot: { name: "Cuso" } },
      } as unknown as ChatRoomMessage,
    ]);
    const kinds = buildThread(overview(), messages).map((item) => item.kind);
    expect(kinds).toEqual(["learning", "brandBrain", "strategy", "message"]);
  });

  it("asks to subscribe and connect only after approval", () => {
    const before = buildThread(overview(), []).map((item) => item.kind);
    expect(before).not.toContain("subscribe");
    const after = buildThread(
      overview({ strategyApprovedAt: new Date("2026-10-01T09:05:00Z") }),
      [],
    ).map((item) => item.kind);
    expect(after.slice(-2)).toEqual(["subscribe", "connect"]);
  });

  it("says what Cuso is waiting for", () => {
    expect(
      cusoStatus(overview({ brandBrain: null, learning: "running" })),
    ).toBe("Learning");
    expect(cusoStatus(overview({ brandBrain: null, learning: "failed" }))).toBe(
      "Stopped",
    );
    expect(cusoStatus(overview())).toBe("Waiting for approval");
    expect(
      cusoStatus(
        overview({
          strategyApprovedAt: new Date(),
          billing: {
            plan: null,
            subscriptionStatus: null,
            availableCredits: 0,
          },
        }),
      ),
    ).toBe("Paused");
  });
});

describe("learning steps", () => {
  it("ticks only what the Brand Brain actually confirmed", () => {
    const brain = overview().brandBrain;
    if (!brain) throw new Error("fixture");
    const steps = learningSteps({
      ...brain,
      audience: ["Not confirmed yet."],
      products: ["Rockets"],
    });
    expect(Object.fromEntries(steps)).toEqual({
      Website: true,
      Products: true,
      Audience: false,
      Competitors: false,
      "Existing marketing": false,
    });
  });
});

describe("cards", () => {
  it("offers Change and Pause on what is up next only after approval", () => {
    const update = {
      id: "u0",
      at: new Date("2026-10-05T09:00:00Z"),
      kind: "request" as const,
      headline: "Plan updated",
      done: [],
      upNext: ["Draft the first LinkedIn post"],
      changes: [],
      revertible: false,
      revertedAt: null,
    };
    const before = renderToStaticMarkup(
      <UpdateCard update={update} actions={noop} approved={false} />,
    );
    expect(before).not.toContain(">Pause<");
    expect(before).not.toContain("No approvals needed");
    const after = renderToStaticMarkup(
      <UpdateCard update={update} actions={noop} approved />,
    );
    expect(after).toContain(">Pause<");
    const history = renderToStaticMarkup(
      <UpdateCard update={update} actions={noop} approved={false} superseded />,
    );
    expect(history).not.toContain("Draft the first LinkedIn post");
  });

  it("offers to revert a monthly strategy, not a Brand Brain refresh", () => {
    const base = {
      id: "u1",
      at: new Date("2026-10-27T09:00:00Z"),
      headline: "November",
      done: [],
      upNext: [],
      changes: ["Two LinkedIn posts a week instead of three"],
      revertedAt: null,
    };
    const monthly = renderToStaticMarkup(
      <UpdateCard
        update={{ ...base, kind: "monthly", revertible: true }}
        actions={noop}
        approved
      />,
    );
    expect(monthly).toContain("What changes from this month");
    expect(monthly).toContain("Revert these changes");
    const brand = renderToStaticMarkup(
      <UpdateCard
        update={{ ...base, kind: "brand", revertible: false }}
        actions={noop}
        approved
      />,
    );
    expect(brand).toContain("What changed in the Brand Brain");
    expect(brand).not.toContain("Revert these changes");
  });

  it("offers Try again when learning failed or got stuck", () => {
    const html = renderToStaticMarkup(
      <LearningCard brain={null} state="failed" actions={noop} />,
    );
    expect(html).toContain("Try again");
    expect(html).toContain("Stopped");
    expect(html).not.toContain("step run");
  });

  it("stops the spinner when Cuso finished with questions", () => {
    const html = renderToStaticMarkup(
      <LearningCard brain={null} state="done" actions={noop} />,
    );
    expect(html).toContain("I have a few questions");
    expect(html).not.toContain("step run");
  });

  it("offers the only approval in the strategy proposal", () => {
    const html = renderToStaticMarkup(
      <StrategyCard overview={overview()} actions={noop} />,
    );
    expect(html).toContain("Approve strategy");
    expect(html).toContain("Change something");
    // Ads have no Sokosumi tool yet.
    expect(html).toContain("Coming soon");
  });

  it("shows an approved strategy without the button", () => {
    const html = renderToStaticMarkup(
      <StrategyCard
        overview={overview({ strategyApprovedAt: new Date() })}
        actions={noop}
      />,
    );
    expect(html).not.toContain("Approve strategy");
    expect(html).toContain("Approved");
  });

  it("lets a weekly review be reverted, and says when it was", () => {
    const update = {
      id: "u1",
      at: new Date("2026-10-05T09:00:00Z"),
      kind: "weekly" as const,
      headline: "Week 1",
      done: [],
      upNext: [],
      changes: ["Two more LinkedIn posts"],
      results: "No provider metrics yet.",
      revertible: true,
      revertedAt: null,
    };
    expect(
      renderToStaticMarkup(
        <UpdateCard update={update} actions={noop} approved />,
      ),
    ).toContain("Revert these changes");
    const reverted = renderToStaticMarkup(
      <UpdateCard
        update={{ ...update, revertible: false, revertedAt: new Date() }}
        actions={noop}
        approved
      />,
    );
    expect(reverted).not.toContain("Revert these changes");
    expect(reverted).toContain("Reverted");
  });
});

describe("pages", () => {
  it("shows real post counts and no invented reach", () => {
    const html = renderToStaticMarkup(
      <ResultsPage
        overview={overview()}
        compose={() => {}}
        openUpdate={() => {}}
      />,
    );
    expect(html).toContain("Drafts");
    expect(html).toContain("report no reach or click numbers");
  });

  it("marks connected accounts and offers to connect the rest", () => {
    const html = renderToStaticMarkup(
      <ChannelsPage
        overview={overview({
          channels: [
            {
              id: "c1",
              provider: "x",
              handle: "@acme",
              displayName: null,
              status: "ACTIVE",
            },
          ],
        })}
        compose={() => {}}
      />,
    );
    expect(html).toContain("@acme");
    expect(html).toContain("Connected");
    expect(html).toContain("Meta ads");
  });
});

describe("renderInline", () => {
  const web = "https://app.sokosumi.com";

  it("turns **bold** into strong text and leaves the rest", () => {
    const html = renderToStaticMarkup(
      <p>{renderInline("I'm **Cuso**, your CMO. 2 * 3 stays.", web)}</p>,
    );
    expect(html).toBe(
      "<p>I&#x27;m <strong>Cuso</strong>, your CMO. 2 * 3 stays.</p>",
    );
  });

  it("opens Core's relative links in Sokosumi", () => {
    const html = renderToStaticMarkup(
      <p>
        {renderInline(
          "Updated social post ([Open post](/social?postId=p1)).",
          web,
        )}
      </p>,
    );
    expect(html).toContain('href="https://app.sokosumi.com/social?postId=p1"');
    expect(html).toContain(">Open post</a>");
    expect(html).not.toContain("](");
  });

  it("drops links that are not web links", () => {
    const html = renderToStaticMarkup(
      <p>{renderInline("[click](javascript:alert(1))", web)}</p>,
    );
    expect(html).not.toContain("href");
  });
});
