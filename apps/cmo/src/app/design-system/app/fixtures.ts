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
    // A social piece is a Social post once the month is approved.
    ...(channel === "newsletter" ? {} : { socialPostId: `e${day}-${channel}` }),
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
  // Facebook is not connected: written, and waiting for the owner.
  entry(16, "facebook", "Meet the crew", {
    imageFileId: "f6",
    status: "draft",
  }),
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

/** A TikTok video of the month: it goes out only once the owner confirms it. */
const TIKTOK_DRAFT: CmoOverview["drafts"][number] = {
  id: "d2",
  provider: "tiktok",
  text: "Three things nobody tells you about a test burn.",
  status: "NEEDS_APPROVAL",
  revision: 0,
  scheduledAt: null,
  publishedUrl: null,
  media: [{ kind: "image", url: PICTURE, name: "test-burn.jpg" }],
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
  strategyShort: null,
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
    level: "active",
    // Growth: the month's third X post and last LinkedIn post wait for Scale.
    beyondPlan: ["e18-x", "e27-linkedin"],
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
      personalProfile: false,
    },
    {
      id: "c2",
      provider: "x",
      handle: "acme_rockets",
      displayName: "Acme Rockets",
      status: "ACTIVE",
      personalProfile: false,
    },
  ],
  adProviders: ["google_ads"],
  postRevisions: Object.fromEntries(
    calendar.flatMap((item) =>
      item.socialPostId ? [[item.socialPostId, 1]] : [],
    ),
  ),
  mailingListSize: 128,
  comments: [
    {
      id: "cmt-1",
      network: "x",
      status: "replied",
      author: "@wutzebaer1",
      text: "+1, metadata is where it usually goes wrong for first-time drops.",
      reply:
        "Agreed. The Studio checks your metadata before the mint, so a typo never reaches the chain.",
      note: null,
      handledAt: "2026-11-22T08:05:00.000Z",
      postUrl: "https://x.com/acme/status/1",
    },
    {
      id: "cmt-2",
      network: "linkedin",
      status: "owner",
      author: "Ana Ruiz",
      text: "We were charged twice this month. Who can help?",
      reply: null,
      note: "Billing question: charged twice",
      handledAt: "2026-11-22T08:06:00.000Z",
      postUrl: null,
    },
    {
      id: "cmt-3",
      network: "instagram",
      status: "replied",
      author: "lena.makes",
      text: "Does this work with Shopify?",
      reply: "Yes, it connects to Shopify in a few clicks.",
      note: null,
      handledAt: "2026-11-21T08:07:00.000Z",
      postUrl: "https://instagram.com/p/1",
    },
  ],
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
  drafts: [WAITING_DRAFT, TIKTOK_DRAFT],
  tiktokEnabled: true,
  measurement: [
    {
      provider: "google_analytics",
      name: "Google Analytics",
      measures: "Visits, where they come from, and sign-ups or sales",
      status: "connected",
    },
    {
      provider: "google_search_console",
      name: "Google Search Console",
      measures: "What people search on Google, and where you show up",
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
  {
    ...message(
      "week",
      true,
      "What your competitors did this week",
      "04T10:02:00",
    ),
    week: {
      checkDay: "2026-11-04",
      moves: [
        {
          competitor: "Calendly",
          text: "Calendly raised Standard from $10 to $12 per seat a month.",
          source: {
            label: "Calendly",
            url: "https://calendly.com/pricing",
          },
          big: true,
          meaning:
            "Calendly's rise leaves your Teams plan the cheaper one for small teams.",
          move: "Lead your pricing page with the price per seat this week.",
        },
        {
          competitor: "SavvyCal",
          text: "SavvyCal added round-robin scheduling for teams.",
          source: {
            label: "savvycal.com",
            url: "https://savvycal.com/blog/round-robin",
          },
          big: false,
        },
        {
          competitor: "Zcal",
          text: "Zcal ends its Pro plan in December 2026.",
          source: {
            label: "it.example.edu",
            url: "https://it.example.edu/notices/zcal",
          },
          big: false,
        },
      ],
    },
  },
  message(
    "m5",
    true,
    "Done. X posts stay under 200 characters.",
    "04T10:03:30",
  ),
];

/** A picture, video or voice-over: nobody else works on it. */
const media = {
  url: null,
  by: null,
  text: null,
  readable: false,
  files: [],
  table: null,
  people: [],
  total: null,
  steps: [],
  turnId: null,
};

/** A full month: five or six posts a day on five networks (150 in all). */
export const busyOverview: CmoOverview = (() => {
  const networks = ["x", "linkedin", "instagram", "facebook", "youtube", "x"];
  const titles = [
    "Why we built it",
    "Inside the test stand",
    "What a slipped launch costs",
    "Meet the crew",
    "How we plan a launch window",
    "Three, two, one",
  ];
  const calendar = Array.from({ length: 30 }, (_, index) => index + 1).flatMap(
    (day) =>
      Array.from({ length: 4 + (day % 3) }, (_, slot) => {
        const channel = networks[(day + slot) % networks.length] ?? "x";
        const id = `busy-${day}-${slot}`;
        // One post X refused yesterday: Today and the Calendar say so.
        const refused = id === "busy-20-4";
        return {
          ...entry(day, channel, titles[(day + slot) % titles.length] ?? ""),
          id,
          time: `${String(8 + slot * 2).padStart(2, "0")}:00`,
          status: refused
            ? ("draft" as const)
            : day < 19
              ? ("published" as const)
              : ("scheduled" as const),
          ...(refused
            ? {
                notSent:
                  "X paused our posting for a day. Ask Cuso to post it again.",
              }
            : {}),
        };
      }),
  );
  const strategy = { ...plan, calendar };
  return { ...overview, strategy, approvedStrategy: strategy };
})();

/**
 * Nothing to show and nothing to do: a month with no posts yet, nothing that
 * needs the owner, and a business whose name runs long.
 */
export const quietOverview: CmoOverview = (() => {
  const strategy = { ...plan, calendar: [] };
  return {
    ...overview,
    businessName: "Northern Lights Handmade Ceramics and Studio Pottery",
    brandVisual: overview.brandVisual
      ? { ...overview.brandVisual, siteName: null }
      : null,
    strategy,
    approvedStrategy: strategy,
    drafts: [],
    posts: { draft: 0, scheduled: 0, published: 0, failed: 0 },
    production: { ...overview.production, state: "ready" as const },
  };
})();

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
    {
      ...media,
      id: "w8",
      kind: "table",
      state: "ready",
      at: new Date("2026-11-04T10:25:00Z"),
      title: "Content tracker",
      readable: true,
      table: {
        columns: ["Post", "Channel", "Status"],
        rows: [
          ["Launch post 1", "X", "Made"],
          ["Launch post 2", "LinkedIn", "Made"],
          ["Launch post 3", "X", "Planned"],
        ],
        total: 12,
      },
    },
    {
      ...media,
      id: "w9",
      kind: "contacts",
      state: "ready",
      at: new Date("2026-11-04T10:26:00Z"),
      title: "Press",
      people: [
        { name: "Mira Lindqvist", detail: "Editor, Product Weekly" },
        { name: "Jonas Feld", detail: null },
      ],
      total: 5,
    },
    {
      ...media,
      id: "w10",
      kind: "run",
      state: "making",
      at: new Date("2026-11-04T10:27:00Z"),
      title: "Results log for the last four weeks",
      steps: [
        { label: "Read last month's posts", state: "done" },
        { label: "Fill the results table", state: "now" },
        { label: "Write the summary", state: "next" },
      ],
      turnId: "run-1",
    },
    {
      ...media,
      id: "w11",
      kind: "question",
      state: "ready",
      at: new Date("2026-11-04T10:28:00Z"),
      title: "How long would a three-trend report take?",
      by: "Hannah",
      text: "About two hours. I need your three main competitors and the market you sell in.",
    },
    {
      ...media,
      id: "w12",
      kind: "seo",
      state: "making",
      at: new Date("2026-11-04T10:29:00Z"),
      title: 'Where you rank on Google for "nft checkout", "mint on your site"',
      by: "The SEO specialist",
    },
    {
      ...media,
      id: "w13",
      kind: "seo",
      state: "ready",
      at: new Date("2026-11-04T10:30:00Z"),
      title: 'Where you rank on Google for "nft minting platform"',
      by: "The SEO specialist",
      text: 'The SEO specialist checked Google on 2026-11-04 for https://nmkr.io/: "nft minting platform" (mobile, US): position 7, 1,300 searches a month. Top results: 1. opensea.io; 2. thirdweb.com',
      readable: true,
    },
    {
      ...media,
      id: "audit-1",
      kind: "audit",
      state: "ready",
      at: new Date("2026-11-04T10:31:00Z"),
      title: "Weekly audit of your site",
      by: "The SEO specialist",
      text: "86 of 110 checks passed. 5 things to fix are in your SEO tab.",
    },
    {
      ...media,
      id: "w14",
      kind: "seo_saved",
      state: "ready",
      at: new Date("2026-11-04T10:32:00Z"),
      title: "Saved to your SEO page",
      suggestions: [
        {
          id: "0198c0de-0000-7000-8000-0000000000a1",
          kind: "page_change",
          source: "cuso",
          title: "Say minting platform in the homepage title",
          keyword: "nft minting platform",
          pageUrl: "https://nmkr.io/",
          why: "Seen 1,300 times at position 7; the title never says it.",
          body: "Replace the homepage title.",
          newText: "NFT Minting Platform for Cardano | NMKR",
          currentText: "NMKR | The Leading Web3 Platform",
          element: "title",
          draft: null,
          sources: [],
          evidence: [],
          status: "open",
          createdAt: new Date("2026-11-04T10:32:00Z"),
          doneAt: null,
          verifiedAt: null,
        },
        {
          id: "0198c0de-0000-7000-8000-0000000000a2",
          kind: "article",
          source: "cuso",
          title: "How to launch an NFT collection on Cardano",
          keyword: "cardano nft marketplace",
          pageUrl: null,
          why: "Google showed nmkr.io 115 times at 8.1; no page answers it yet.",
          body: "## Plan the collection\n## Mint it\n## List it",
          newText: null,
          currentText: null,
          element: null,
          draft: null,
          sources: [],
          evidence: [],
          status: "open",
          createdAt: new Date("2026-11-04T10:32:00Z"),
          doneAt: null,
          verifiedAt: null,
        },
      ],
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
    retryAt: null,
    failedTries: 0,
    latest: {
      observedAt: seoAt("2026-11-16T06:12:00Z"),
      checked: 110,
      passed: 86,
      failedChecks: 6,
      readingChecks: 18,
      readings: [
        {
          title: "Title length",
          pageUrl: "https://acme.io/",
          detail: "title 45 characters",
        },
        {
          title: "Meta description length",
          pageUrl: "https://acme.io/",
          detail: "meta description 147 characters",
        },
        {
          title: "Redirect hops",
          pageUrl: "https://acme.io/",
          detail: "1 redirect hop before the final URL",
        },
      ],
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
    previousTotals: {
      clicks: 368,
      impressions: 17_210,
      ctr: 0.0214,
      position: 15.9,
    },
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
      currentText: "Teams | Acme: scheduling infrastructure for everyone",
      element: "title",
      draft: null,
      sources: [],
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
      currentText: null,
      element: null,
      draft: null,
      sources: [],
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
      currentText: null,
      element: null,
      draft: null,
      sources: [],
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
  landingPages: [
    {
      id: "0198c0de-0000-7000-8000-000000000009",
      kind: "landing_page",
      source: "cuso",
      title: "Calendly alternative for teams that want their own booking page",
      keyword: "calendly alternative",
      pageUrl: null,
      why: "880 people a month search this while they choose, and your search ad for it has no page that answers them.",
      body: "",
      newText: null,
      currentText: null,
      element: null,
      draft:
        "# Calendly alternative for teams that want their own booking page\n\nLooking for a Calendly alternative? Acme gives every teammate a booking page on your own domain, free for one person.\n\n## What you get\n\n- A booking page on your domain\n- Round-robin for the whole team\n\n## Acme and Calendly side by side\n\nCalendly's Standard plan costs $12 per seat a month, billed yearly. Acme is free for one person.\n\nIf you only need one meeting type, Calendly's free plan may be all you need.",
      sources: [
        {
          text: "Calendly's Standard plan costs $12 per seat a month, billed yearly.",
          sourceUrl: "https://calendly.com/pricing",
          quote: "Standard $12 /seat/mo billed yearly",
        },
      ],
      evidence: [
        {
          metric: "searchVolume",
          keyword: "calendly alternative",
          pageUrl: null,
          value: "880",
          source: "keyword_research",
          observedAt: seoAt("2026-11-19T09:00:00Z"),
        },
      ],
      status: "open",
      createdAt: seoAt("2026-11-19T09:00:00Z"),
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
          impressions: 412,
          clicks: 9,
        },
        {
          keyword: "free team booking software",
          searchVolume: 140,
          difficulty: 24,
          intent: "commercial",
          position: null,
          positionSource: null,
          impressions: null,
          clicks: null,
        },
        {
          keyword: "team booking app free",
          searchVolume: 10,
          difficulty: null,
          intent: "commercial",
          position: null,
          positionSource: null,
          impressions: null,
          clicks: null,
        },
        {
          keyword: "booking software for sales teams",
          searchVolume: null,
          difficulty: null,
          intent: null,
          position: null,
          positionSource: null,
          impressions: null,
          clicks: null,
        },
      ],
    },
  ],
  keywordSearchesLeft: 24,
};
