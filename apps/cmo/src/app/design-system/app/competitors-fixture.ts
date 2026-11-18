import type { CmoCompetitors } from "@sokosumi/core-client";

const AT = new Date("2026-11-16T09:00:00.000Z");
const ids = {
  northwind: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
  globex: "aaaaaaaa-aaaa-4aaa-8aaa-000000000002",
  initech: "aaaaaaaa-aaaa-4aaa-8aaa-000000000003",
  price: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001",
  launch: "bbbbbbbb-bbbb-4bbb-8bbb-000000000002",
  hire: "bbbbbbbb-bbbb-4bbb-8bbb-000000000003",
};

function instagram(handle: string, value: number, observedAt = AT) {
  return {
    value,
    sourceUrl: `https://www.instagram.com/${handle}/`,
    observedAt,
  };
}

function competitor(id: string, name: string, host: string) {
  return {
    id,
    name,
    websiteUrl: `https://${host}/`,
    pricingUrl: `https://${host}/pricing`,
    instagramHandle: host.split(".")[0] ?? null,
    facebookHandle: null,
    source: "RESEARCH" as const,
    createdAt: new Date("2026-11-01T09:00:00.000Z"),
  };
}

/** A week with a price change, a launch and one open question, for the fixture screens. */
export const competitors: CmoCompetitors = {
  competitors: [
    competitor(ids.northwind, "Northwind", "northwind.example"),
    competitor(ids.globex, "Globex", "globex.example"),
    competitor(ids.initech, "Initech", "initech.example"),
  ],
  limit: 5,
  mapPlayers: ["Orbit Labs", "Moonshot", "LaunchPad"],
  feed: {
    checkDay: "2026-11-16",
    savedAt: AT,
    items: [
      {
        id: "cccccccc-cccc-4ccc-8ccc-000000000001",
        competitorId: ids.northwind,
        facts: [
          {
            text: "Northwind raised its Pro plan from $12 to $15 a seat.",
            signalIds: [ids.price],
            support: "strong",
          },
        ],
        meaning:
          "Your Team plan at $12 is now the cheaper one for teams of five and more.",
        move: "Lead Tuesday's LinkedIn post with your price per seat.",
        big: true,
        addedToStrategyAt: null,
      },
      {
        id: "cccccccc-cccc-4ccc-8ccc-000000000002",
        competitorId: ids.globex,
        facts: [
          {
            text: "Globex launched a free plan for teams of up to three.",
            signalIds: [ids.launch],
            support: "weak",
          },
        ],
        meaning:
          "Small teams comparing you with Globex now see a free way in there.",
        move: "Put your 14-day trial at the top of the pricing page this week.",
        big: true,
        addedToStrategyAt: "2026-11-16T10:00:00.000Z",
      },
    ],
    openQuestions: [
      "Whether Globex's free plan includes routing: its page does not say.",
    ],
  },
  signals: [
    {
      id: ids.price,
      competitorId: ids.northwind,
      kind: "PRICE_CHANGE",
      summary: "Pro plan $12 -> $15 a seat",
      observedAt: AT,
      sourceUrl: "https://northwind.example/pricing",
      sourceTitle: "Northwind pricing",
      sourcePublisher: "Northwind",
      quote: "Pro $15 per seat a month, billed yearly",
    },
    {
      id: ids.launch,
      competitorId: ids.globex,
      kind: "NEWS",
      summary: "Globex launched a free plan for small teams",
      observedAt: new Date("2026-11-13T00:00:00.000Z"),
      sourceUrl: "https://technews.example/globex-free-plan",
      sourceTitle: "Globex adds a free tier",
      sourcePublisher: "technews.example",
      quote: "Globex said teams of up to three can now use it for free.",
    },
    {
      id: ids.hire,
      competitorId: ids.initech,
      kind: "WEBSITE_CHANGE",
      summary: "Homepage now leads with a customer story from a bank",
      observedAt: AT,
      sourceUrl: "https://initech.example/",
      sourceTitle: "Initech homepage",
      sourcePublisher: "Initech",
      quote: "How a 400-person bank cut scheduling time in half",
    },
  ],
  scoreboard: [
    {
      competitorId: null,
      name: "acme.io",
      postsPerWeek: instagram("acme", 4),
      engagementPerPost: instagram("acme", 86),
      followers: instagram("acme", 2140),
      followerGrowth: instagram("acme", 35),
    },
    {
      competitorId: ids.northwind,
      name: "Northwind",
      postsPerWeek: instagram("northwind", 6),
      engagementPerPost: instagram("northwind", 412),
      followers: instagram("northwind", 41200),
      followerGrowth: instagram("northwind", -120),
    },
    {
      competitorId: ids.globex,
      name: "Globex",
      postsPerWeek: instagram("globex", 2),
      engagementPerPost: instagram("globex", 58),
      followers: instagram("globex", 3400),
      followerGrowth: null,
    },
    {
      competitorId: ids.initech,
      name: "Initech",
      postsPerWeek: null,
      engagementPerPost: null,
      followers: null,
      followerGrowth: null,
    },
  ],
  topPosts: [
    {
      competitorId: ids.northwind,
      signalId: "dddddddd-dddd-4ddd-8ddd-000000000001",
      url: "https://www.instagram.com/p/abc/",
      caption: "Five scheduling habits of teams that never double-book.",
      type: "CAROUSEL_ALBUM",
      postedAt: new Date("2026-11-10T09:00:00.000Z"),
      likes: 1240,
      comments: 86,
    },
    {
      competitorId: ids.northwind,
      signalId: "dddddddd-dddd-4ddd-8ddd-000000000001",
      url: "https://www.instagram.com/p/def/",
      caption: "Our new routing rules, in 30 seconds.",
      type: "REELS",
      postedAt: new Date("2026-11-04T09:00:00.000Z"),
      likes: null,
      comments: 41,
    },
  ],
  check: {
    lastCheckedAt: AT,
    nextCheckAt: new Date("2026-11-22T21:00:00.000Z"),
    creditsPerCompetitor: 3,
    sources: {
      pages: { status: "ok", needs: null },
      news: { status: "ok", needs: null },
      ads: {
        status: "not_configured",
        needs:
          "Reading ads needs CMO's access to Meta's Ad Library, which is not set up yet.",
      },
      social: { status: "ok", needs: null },
    },
  },
};

/** A new Cuso: nobody watched, no check yet, no Instagram connected. */
export const noCompetitors: CmoCompetitors = {
  competitors: [],
  limit: 5,
  mapPlayers: [],
  feed: null,
  signals: [],
  scoreboard: [
    {
      competitorId: null,
      name: "acme.io",
      postsPerWeek: null,
      engagementPerPost: null,
      followers: null,
      followerGrowth: null,
    },
  ],
  topPosts: [],
  check: {
    lastCheckedAt: null,
    nextCheckAt: null,
    creditsPerCompetitor: 3,
    sources: {
      ...competitors.check.sources,
      social: {
        status: "not_connected",
        needs:
          "Connect your Instagram business account to see competitors' Instagram numbers.",
      },
    },
  },
};
