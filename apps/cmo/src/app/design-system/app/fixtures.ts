import type { CmoOverview, CmoSeo } from "@sokosumi/core-client";
import { AGENT_NAME } from "../../../lib/agent";
import type { CusoMessage } from "../../../lib/chat-messages";
import type { ChatWork } from "../../../lib/chat-work";
import { VIEW_PATHS, type View } from "../../../lib/views";
import {
  cmoBilling,
  cmoOverview,
  cmoStrategyVersion,
} from "../../../test-fixtures/cmo";
import { richBrain, richPlan } from "../../../test-fixtures/onboarding";

export const VIEWS = Object.keys(VIEW_PATHS) as View[];

export function isView(value: string): value is View {
  return (VIEWS as string[]).includes(value);
}

type Plan = NonNullable<CmoOverview["strategy"]>;
type Entry = Plan["calendar"][number];

const PICTURE = "/cuso/walking.png";

function entry(
  day: number,
  channel: string,
  title: string,
  patch: Partial<Entry> = {},
): Entry {
  return {
    id: `e${day}-${channel}`,
    date: `2026-11-${String(day).padStart(2, "0")}`,
    time: "09:00",
    channel,
    title,
    format: "post",
    status: "scheduled",
    pillar: day % 2 ? "Launch stories" : "How we build",
    approach: day % 2 ? "educational" : "product-led",
    hook: `${title}: the short version.`,
    draft: `${title}.\n\nWe build rockets for teams that ship on time.`,
    ...patch,
  };
}

const calendar: Entry[] = [
  entry(2, "linkedin", "Why we built it", { status: "published" }),
  entry(4, "x", "Launch day countdown", {
    status: "published",
    imageFileId: "f1",
  }),
  entry(6, "linkedin", "Inside the test stand", { imageFileId: "f2" }),
  entry(9, "instagram", "Three, two, one", {
    format: "carousel",
    slideFileIds: ["f3", "f4", "f5"],
  }),
  entry(11, "x", "What a slipped launch costs", { status: "draft" }),
  entry(13, "linkedin", "How we plan a launch window", { status: "draft" }),
  entry(16, "facebook", "Meet the crew", { imageFileId: "f6" }),
  entry(17, "instagram", "Why launches slip", {
    format: "talking_video",
    alsoOn: ["youtube", "facebook"],
  }),
  entry(18, "x", "Ask us anything", { status: "idea", draft: undefined }),
  entry(20, "linkedin", "Customer story: Moonshot", { status: "idea" }),
  entry(24, "newsletter", "November launches", {
    format: "newsletter",
    status: "draft",
    draft: "Subject: Our November launches\n\nThree flew. One waited.",
  }),
  entry(27, "linkedin", "Lessons from the month", { status: "idea" }),
];

const plan: Plan = {
  ...richPlan,
  month: "2026-11",
  summary: "Show the rockets working, one launch story a week.",
  why: "Product teams read LinkedIn and X.",
  channels: [
    { channel: "linkedin", cadence: "3 a week", why: "Where buyers are" },
    { channel: "x", cadence: "2 a week" },
    { channel: "instagram", cadence: "1 a week" },
    { channel: "facebook", cadence: "1 a week" },
    { channel: "newsletter", cadence: "1 a month" },
  ],
  calendar,
  questions: [],
};

const at = (iso: string) => new Date(`2026-11-${iso}Z`);

/** A post Cuso made on request, outside the month: it waits for the owner. */
const WAITING_DRAFT: CmoOverview["drafts"][number] = {
  id: "d1",
  provider: "x",
  text: "Every engine we ship runs on the test stand first.\n\nHere is what a full burn looks like from two metres away.",
  status: "NEEDS_APPROVAL",
  revision: 0,
  scheduledAt: null,
  publishedUrl: null,
  media: [{ kind: "image", url: PICTURE, name: "test-stand.jpg" }],
};

export const overview: CmoOverview = cmoOverview({
  ...cmoStrategyVersion(new Date("2026-11-01T09:10:00Z")),
  businessName: "Acme",
  websiteUrl: "https://acme.io",
  projectLogo: PICTURE,
  presenterSet: false,
  brandBrain: {
    ...richBrain,
    questions: [],
    profile: {
      company: {
        headline: "Acme builds rockets",
        answer:
          "A twelve-person company in Hamburg that sells reusable rockets.",
        findings: [
          {
            point: "Founded in 2021 by two ex-aerospace engineers.",
            evidence: "fact",
            confidence: "high",
            sourceUrl: "https://acme.io/about",
          },
          {
            point: "Growing about 10% a month.",
            evidence: "claim",
            confidence: "medium",
          },
        ],
      },
      offer: {
        headline: "Rocket Pro for teams",
        answer: "One plan: Rocket Pro at $99 a month with a 14-day trial.",
      },
      customers: {
        headline: "Product teams of ten to fifty",
        answer: "Teams that ship hardware on a deadline.",
      },
      positioning: {
        headline: "The rocket that ships on time",
        answer: "Reliability over price, against Moonshot's discounts.",
      },
      marketing: {
        headline: "Mostly LinkedIn",
        answer: "About one post a week and no ads.",
      },
    },
  },
  brandBrainUpdatedAt: at("01T09:01:00"),
  brandBrainConfirmedAt: at("01T09:05:00"),
  strategy: plan,
  approvedStrategy: plan,
  onboardingStep: "done",
  botStatus: "IDLE",
  viewerCanApprove: true,
  createdAt: at("01T09:00:00"),
  media: [
    { entryId: "e4-x", kind: "image", url: PICTURE },
    { entryId: "e6-linkedin", kind: "image", url: PICTURE },
    {
      entryId: "e9-instagram",
      kind: "image",
      url: PICTURE,
      slides: [PICTURE, PICTURE, PICTURE],
    },
    { entryId: "e16-facebook", kind: "image", url: PICTURE },
  ],
  production: {
    state: "running",
    ready: 8,
    total: 11,
    written: 11,
    pictured: 5,
    needPictures: 6,
    finishedAt: null,
    pillars: {
      shares: [
        { name: "Launch stories", planned: 60, made: 64, pieces: 7 },
        { name: "How we build", planned: 40, made: 36, pieces: 4 },
      ],
      rewriting: false,
    },
  },
  timeZone: "Europe/Berlin",
  routines: [
    {
      key: "cmo-daily-run",
      name: "Daily marketing run",
      when: "Every day at 09:00",
      description: "Prepares what the calendar has due.",
      nextRunAt: at("06T09:00:00"),
      timezone: "Europe/Berlin",
    },
    {
      key: "cmo-weekly-review",
      name: "Weekly review",
      when: "Mondays at 09:00",
      description: "Reads the week's results and adjusts the strategy.",
      nextRunAt: at("09T09:00:00"),
      timezone: "Europe/Berlin",
    },
  ],
  channels: [
    {
      id: "c1",
      provider: "linkedin",
      handle: "acme",
      displayName: "Acme",
      status: "ACTIVE",
    },
    {
      id: "c2",
      provider: "x",
      handle: "acme_rockets",
      displayName: "Acme Rockets",
      status: "ACTIVE",
    },
  ],
  adProviders: ["google_ads"],
  mailingListSize: 128,
  billing: cmoBilling({
    tier: "growth",
    interval: "month",
    status: "active",
    periodEnd: new Date("2026-12-13T10:00:00Z"),
    availableCredits: 8400,
  }),
  posts: { draft: 3, scheduled: 5, published: 2, failed: 0 },
  upNext: [
    {
      id: "e6-linkedin",
      date: "2026-11-06",
      channel: "linkedin",
      title: "Inside the test stand",
      status: "scheduled",
    },
    {
      id: "e9-instagram",
      date: "2026-11-09",
      channel: "instagram",
      title: "Three, two, one",
      status: "scheduled",
    },
    {
      id: "e11-x",
      date: "2026-11-11",
      channel: "x",
      title: "What a slipped launch costs",
      status: "draft",
    },
  ],
  updates: [
    {
      id: "u1",
      kind: "daily",
      headline: "Scheduled two posts and wrote a draft for Tuesday",
      done: [
        "Scheduled “Inside the test stand” on LinkedIn",
        "Made the carousel for Instagram",
      ],
      upNext: ["Draft the newsletter"],
      at: at("04T09:05:00"),
      revertible: false,
      revertedAt: null,
      posts: [],
      media: [],
    },
    {
      id: "u2",
      kind: "weekly",
      headline: "Week one: 1,240 profile visits, 31 demo clicks",
      results:
        "LinkedIn carried the week; X posts got about a third of the clicks.",
      changes: ["Move the X launch posts to the morning"],
      at: at("03T09:00:00"),
      revertible: true,
      revertedAt: null,
      posts: [],
      media: [],
    },
    {
      id: "u3",
      kind: "request",
      headline: "X posts shortened",
      done: ["Cut four X posts to under 200 characters"],
      upNext: ["Keep new X posts that short"],
      at: at("04T10:03:40"),
      revertible: false,
      revertedAt: null,
      posts: [],
      media: [],
    },
    {
      id: "u4",
      kind: "request",
      headline: "Test stand post ready for you",
      done: ["Made the picture", "Wrote the post for X"],
      upNext: [],
      at: at("04T11:20:00"),
      revertible: false,
      revertedAt: null,
      posts: [WAITING_DRAFT],
      media: [],
    },
  ],
  drafts: [WAITING_DRAFT],
  measurement: [
    {
      provider: "google_analytics",
      name: "Google Analytics",
      measures: "Visits, where they come from and conversions",
      status: "connected",
    },
    {
      provider: "google_search_console",
      name: "Google Search Console",
      measures: "Searches, clicks and rankings",
      status: "none",
    },
    {
      provider: "shopify",
      name: "Shopify",
      measures: "Orders and revenue",
      status: "none",
    },
  ],
});

const message = (
  id: string,
  fromCuso: boolean,
  content: string,
  time: string,
): CusoMessage => ({
  id,
  fromCuso,
  author: fromCuso ? AGENT_NAME : "Francis",
  content,
  createdAt: `2026-11-${time}Z`,
});

export const messages: CusoMessage[] = [
  message(
    "m1",
    true,
    "Your month is planned. I will write and schedule every post.",
    "01T09:12:00",
  ),
  message(
    "m2",
    false,
    "Can the Instagram carousel lead with the test stand?",
    "04T10:00:00",
  ),
  {
    ...message(
      "m3",
      true,
      "Yes. I moved **Three, two, one** to open on the test stand. See it on the [Calendar](/calendar).",
      "04T10:01:00",
    ),
    trace: {
      steps: ["Reading your posts", "Changing a post"],
      thoughts: [
        "The carousel opens on the countdown. The test stand is its strongest picture, so it goes first and the countdown follows.",
      ],
    },
  },
  message("m4", false, "Great. Keep X posts short.", "04T10:03:00"),
  message(
    "m5",
    true,
    "Done. X posts stay under 200 characters.",
    "04T10:03:30",
  ),
];

/** A picture, video or voice-over: nobody else works on it. */
const media = { url: null, by: null, text: null, readable: false, files: [] };

/**
 * The chat page's own state: a long German message, to check how the thread
 * wraps, and Cuso at work, so the typing row shows above the composer.
 */
export const chat = {
  overview: { ...overview, botStatus: "RUNNING" as const },
  messages: [
    ...messages,
    message(
      "m6",
      false,
      "Bitte schreibe die LinkedIn-Beiträge für die Produkteinführung auf Deutsch, mit einem klaren Nutzenversprechen für Produktverantwortliche und einem Hinweis auf die vierzehntägige Testphase. Die Geschwindigkeitsbegrenzung im Wettbewerbsvergleich darf nicht fehlen.",
      "04T10:05:00",
    ),
    message(
      "m7",
      false,
      "Make a picture, a short video and a voice-over for the launch, write the brief, and get the research done.",
      "04T10:20:00",
    ),
    message("m8", true, "Started image.\n\nStarted video.", "04T10:20:01"),
  ],
  // What Cuso makes and hands on in the chat, in each state it can be in.
  work: [
    {
      ...media,
      id: "w1",
      kind: "image",
      state: "ready",
      at: new Date("2026-11-04T10:20:10Z"),
      title: "The launch on a phone",
      url: "/cuso/walking.png",
    },
    {
      ...media,
      id: "w2",
      kind: "video",
      state: "making",
      at: new Date("2026-11-04T10:20:20Z"),
      title: "A walk through the launch",
    },
    {
      ...media,
      id: "w3",
      kind: "audio",
      state: "failed",
      at: new Date("2026-11-04T10:20:30Z"),
      title: "Launch day is here.",
    },
    {
      ...media,
      id: "w4",
      kind: "file",
      state: "ready",
      at: new Date("2026-11-04T10:21:00Z"),
      title: "Launch brief.md",
      url: "/cuso/walking.png",
      readable: true,
    },
    {
      ...media,
      id: "w5",
      kind: "task",
      state: "making",
      at: new Date("2026-11-04T10:22:00Z"),
      title: "Research three launch trends",
      by: "Hannah",
    },
    {
      ...media,
      id: "w6",
      kind: "task",
      state: "waiting",
      at: new Date("2026-11-04T10:23:00Z"),
      title: "Write the press note",
      by: "Alex",
      text: "Which date goes in the headline, the 12th or the 14th?",
    },
    {
      ...media,
      id: "w7",
      kind: "agent",
      state: "ready",
      at: new Date("2026-11-04T10:24:00Z"),
      title: "Market scan for product teams",
      by: "Market Scout",
      text: "Three trends stand out this quarter: loyalty passes replace one-off drops, brands mint on their own site, and buyers pay by card.",
      readable: true,
      files: [{ name: "market-scan.pdf", url: "/cuso/walking.png" }],
    },
  ] satisfies ChatWork[],
};

const seoAt = (iso: string) => new Date(iso);

/** The SEO tab over a week's real-shaped data: an audit, Search Console, ideas. */
export const seo: CmoSeo = {
  websiteUrl: "https://acme.io",
  countryCode: "US",
  languageCode: "en",
  audit: {
    creditsPerAudit: 750,
    status: "active",
    nextRunAt: seoAt("2026-11-23T06:00:00Z"),
    running: false,
    skipped: [],
    lastFailedAt: null,
    latest: {
      observedAt: seoAt("2026-11-16T06:12:00Z"),
      checked: 110,
      passed: 86,
      issues: [
        {
          title: "Structured data",
          pageUrl: "https://acme.io/",
          severity: "major",
          detail:
            "The offer price in the markup (6.99) is not the price the page shows (9.99).",
        },
        {
          title: "Permanent redirects",
          pageUrl: "https://acme.io/",
          severity: "minor",
          detail:
            "acme.io sends visitors to www.acme.io with a temporary redirect.",
        },
        {
          title:
            "Script and style files for rendering load and are not blocked",
          pageUrl: "https://acme.io/",
          severity: "minor",
          detail:
            "1 of 17 script and style files rendering asks for failed to load",
        },
      ],
      fixes: [],
    },
  },
  searchConsole: {
    status: "connected",
    property: "sc-domain:acme.io",
    from: "2026-10-17",
    to: "2026-11-13",
    observedAt: seoAt("2026-11-17T08:00:00Z"),
    totals: { clicks: 412, impressions: 18_940, ctr: 0.0218, position: 14.6 },
    nearFirstPage: [
      {
        query: "team booking software",
        pageUrl: "https://acme.io/teams",
        clicks: 9,
        impressions: 1_820,
        ctr: 0.0049,
        position: 11.4,
      },
    ],
    lowClickRate: [
      {
        query: "acme pricing",
        pageUrl: "https://acme.io/pricing",
        clicks: 4,
        impressions: 640,
        ctr: 0.0063,
        position: 2.1,
      },
    ],
  },
  pageChanges: [
    {
      id: "0198c0de-0000-7000-8000-000000000001",
      kind: "page_change",
      source: "cuso",
      title: "Name team booking in the Teams page title",
      keyword: "team booking software",
      pageUrl: "https://acme.io/teams",
      why: "The page ranks 11 for the search that sells Teams; its title never says team booking.",
      body: "Replace the page title.",
      newText: "Team Booking Software for Sales and Support | Acme",
      draft: null,
      evidence: [
        {
          metric: "position",
          keyword: "team booking software",
          pageUrl: "https://acme.io/teams",
          value: "11.4",
          source: "search_console",
          observedAt: seoAt("2026-11-17T08:00:00Z"),
        },
        {
          metric: "impressions",
          keyword: "team booking software",
          pageUrl: "https://acme.io/teams",
          value: "1,820",
          source: "search_console",
          observedAt: seoAt("2026-11-17T08:00:00Z"),
        },
      ],
      status: "open",
      createdAt: seoAt("2026-11-17T09:00:00Z"),
      doneAt: null,
      verifiedAt: null,
    },
    {
      id: "0198c0de-0000-7000-8000-000000000003",
      kind: "page_change",
      source: "audit",
      title: "Fix the HubSpot script that fails to load during rendering",
      keyword: null,
      pageUrl: "https://acme.io/",
      why: "The Finding RN-01 shows that 1 of the 17 script and style files the page's main frame requested during rendering failed: https://js-eu1.hs-scripts.com/27172445.js returned net::ERR_BLOCKED_BY_ORB. This is the HubSpot tracking/chat script. Since the page cannot rely on this file loading, check why the response is blocked: an ORB block usually means the file is served with a wrong Content-Type, is redirected to a non-script response (for example an HTML error page, a consent/cookie-walled response, or a bot-block), or is served from a region/CDN path that returns an unexpected body. Verify the URL returns the JavaScript directly (correct Content-Type: application/javascript, HTTP 200, no redirect to HTML), and if the HubSpot snippet is outdated, update it to the current embed code from the HubSpot account for portal ID 27172445. If the script is not intended to load for non-browser or non-EU contexts, make sure the page degrades gracefully without it. Note: the loading check for the 20 file URLs on hosts whose robots.txt the run did not read was limited to loading only, so robots.txt on those hosts was not checked.",
      body: "Once the script loads correctly, the page's render is complete and any HubSpot chat or tracking behavior works as intended for visitors and for Googlebot's render of the page. This removes the render error itself; no rank or traffic change can be forecast from it.",
      newText: null,
      draft: null,
      evidence: [
        {
          metric: "auditIssue",
          keyword: null,
          pageUrl: "https://acme.io/",
          value:
            "Script and style files for rendering load and are not blocked",
          source: "weekly_audit",
          observedAt: seoAt("2026-11-16T06:12:00Z"),
        },
      ],
      status: "open",
      createdAt: seoAt("2026-11-16T06:20:00Z"),
      doneAt: null,
      verifiedAt: null,
    },
  ],
  articles: [
    {
      id: "0198c0de-0000-7000-8000-000000000002",
      kind: "article",
      source: "cuso",
      title: "The best Calendly alternative for teams",
      keyword: "calendly alternative",
      pageUrl: null,
      why: "Buyers comparing tools search this every month, and no page of yours answers it.",
      body: "## Who needs an alternative\n## Acme and Calendly side by side\n## How to switch in a day",
      newText: null,
      draft: null,
      evidence: [
        {
          metric: "searchVolume",
          keyword: "calendly alternative",
          pageUrl: null,
          value: "880",
          source: "keyword_research",
          observedAt: seoAt("2026-11-17T09:00:00Z"),
        },
        {
          metric: "difficulty",
          keyword: "calendly alternative",
          pageUrl: null,
          value: "21",
          source: "keyword_research",
          observedAt: seoAt("2026-11-17T09:00:00Z"),
        },
      ],
      status: "open",
      createdAt: seoAt("2026-11-17T09:00:00Z"),
      doneAt: null,
      verifiedAt: null,
    },
  ],
  keywordSearches: [
    {
      topic: "team booking software",
      countryCode: "US",
      languageCode: "en",
      observedAt: seoAt("2026-11-17T09:00:00Z"),
      ideas: [
        {
          keyword: "team booking software",
          searchVolume: 1_300,
          difficulty: 38,
          intent: "commercial",
          position: 11.4,
          positionSource: "search_console",
        },
        {
          keyword: "free team booking software",
          searchVolume: 140,
          difficulty: 24,
          intent: "commercial",
          position: null,
          positionSource: null,
        },
        {
          keyword: "team booking app free",
          searchVolume: 10,
          difficulty: null,
          intent: "commercial",
          position: null,
          positionSource: null,
        },
        {
          keyword: "booking software for sales teams",
          searchVolume: null,
          difficulty: null,
          intent: null,
          position: null,
          positionSource: null,
        },
      ],
    },
  ],
  keywordSearchesLeft: 24,
};
