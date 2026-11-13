/**
 * What the SEO agent and the SEO tab cannot do yet, for the Improve tab. Hand-written from the SEO bot's
 * `docs/seo-feature-gaps.md` (repository masumi-network/seo-bot, 45 items in 8 groups); the bot publishes the
 * same items as `docs/seo-capabilities.json` with the same ids (the doc's item numbers). Statuses are as of
 * SEO_CAPABILITIES_AS_OF, except items 34 and 38, which this web build adds.
 */

export const SEO_CAPABILITIES_AS_OF = "2026-11-13";

/** The doc's groups, in its order. */
export const SEO_CAPABILITY_GROUPS = [
  "technical",
  "content",
  "keywords",
  "links",
  "local",
  "measurement",
  "ai",
  "workflow",
] as const;
export type SeoCapabilityGroup = (typeof SEO_CAPABILITY_GROUPS)[number];

export type SeoCapabilityStatus = "built" | "partial" | "missing" | "planned";

/** What it takes to get an item: a step of the reader, paid data, or work of the team. */
export const SEO_CAPABILITY_UNLOCKS = [
  "search_console",
  "ga4",
  "ga4_key_events",
  "paid_data",
  "development",
  "owner_decision",
] as const;
export type SeoCapabilityUnlock = (typeof SEO_CAPABILITY_UNLOCKS)[number];

/** The item numbers of the doc: a message catalog keyed by them can be checked for every item. */
export type SeoCapabilityId =
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15
  | 16
  | 17
  | 18
  | 19
  | 20
  | 21
  | 22
  | 23
  | 24
  | 25
  | 26
  | 27
  | 28
  | 29
  | 30
  | 31
  | 32
  | 33
  | 34
  | 35
  | 36
  | 37
  | 38
  | 39
  | 40
  | 41
  | 42
  | 43
  | 44
  | 45;

export interface SeoCapability {
  /** The item number in the doc. */
  id: SeoCapabilityId;
  group: SeoCapabilityGroup;
  /** English; the web shows its own translation by id. */
  title: string;
  status: SeoCapabilityStatus;
  /** What is missing, in English; null for a built item. */
  missing: string | null;
  unlocks: SeoCapabilityUnlock[];
}

const DEV = "development";
const OWNER = "owner_decision";
const GSC = "search_console";
const PAID = "paid_data";

export const SEO_CAPABILITIES: readonly SeoCapability[] = [
  {
    id: 1,
    group: "technical",
    title: "Full-site crawl",
    status: "partial",
    missing:
      "An audit reads at most 10 pages. No crawl of every linked or listed URL.",
    unlocks: [DEV],
  },
  {
    id: 2,
    group: "technical",
    title: "Site-wide broken links and redirect chains",
    status: "partial",
    missing: "No list of broken links and redirect chains for the whole site.",
    unlocks: [DEV],
  },
  {
    id: 3,
    group: "technical",
    title: "Index coverage for all URLs",
    status: "partial",
    missing:
      "Google's index state shows for checked pages only, not for every sitemap URL.",
    unlocks: [GSC, DEV],
  },
  {
    id: 4,
    group: "technical",
    title: "Orphan pages",
    status: "missing",
    missing: "No list of pages that no other page links to.",
    unlocks: [DEV],
  },
  {
    id: 5,
    group: "technical",
    title: "Near-duplicate and thin pages",
    status: "missing",
    missing: "No check for pages with almost the same main text.",
    unlocks: [DEV],
  },
  {
    id: 6,
    group: "technical",
    title: "Core Web Vitals in the SEO tab",
    status: "partial",
    missing: "The agent reads Core Web Vitals, but the tab does not show them.",
    unlocks: [DEV],
  },
  {
    id: 7,
    group: "technical",
    title: "Site migration check",
    status: "missing",
    missing: "No check of the redirects of a domain or URL move.",
    unlocks: [DEV],
  },
  {
    id: 8,
    group: "technical",
    title: "Googlebot crawl data",
    status: "missing",
    missing: "No import of server logs or of the Crawl Stats report.",
    unlocks: [OWNER],
  },
  {
    id: 9,
    group: "content",
    title: "Content brief for a target keyword",
    status: "partial",
    missing:
      "No brief of the subtopics and questions of the top results for one keyword.",
    unlocks: [DEV],
  },
  {
    id: 10,
    group: "content",
    title: "Body text drafts and rewrites",
    status: "partial",
    missing: "The agent drafts titles and descriptions only, not body text.",
    unlocks: [OWNER],
  },
  {
    id: 11,
    group: "content",
    title: "Content refresh queue",
    status: "partial",
    missing: "No list of all pages that lost clicks against the year before.",
    unlocks: [GSC, DEV],
  },
  {
    id: 12,
    group: "content",
    title: "Cannibalization from Search Console",
    status: "partial",
    missing: "Checked for audited pages only, not for every query of the site.",
    unlocks: [GSC, DEV],
  },
  {
    id: 13,
    group: "content",
    title: "Author, About and Contact signals",
    status: "missing",
    missing:
      "No check for an author profile, an About page and a Contact page.",
    unlocks: [DEV],
  },
  {
    id: 14,
    group: "content",
    title: "Publication date checks",
    status: "partial",
    missing:
      "Only future dates are checked, not the visible date against the structured data.",
    unlocks: [DEV],
  },
  {
    id: 15,
    group: "content",
    title: "Topic cluster map",
    status: "partial",
    missing: "No map of the site's topics and of the topics with no page.",
    unlocks: [OWNER],
  },
  {
    id: 16,
    group: "keywords",
    title: "Rank history for tracked keywords",
    status: "partial",
    missing: "Paid positions show the latest check only. No stored history.",
    unlocks: [PAID, DEV],
  },
  {
    id: 17,
    group: "keywords",
    title: "SERP features over time",
    status: "partial",
    missing:
      "No history of AI Overviews, featured snippets and other result features.",
    unlocks: [PAID, DEV],
  },
  {
    id: 18,
    group: "keywords",
    title: "City-level rank",
    status: "missing",
    missing: "Ranks are read per country only, not per city.",
    unlocks: [PAID, DEV],
  },
  {
    id: 19,
    group: "keywords",
    title: "Share of voice",
    status: "missing",
    missing:
      "No share of clicks against competitors over the tracked keywords.",
    unlocks: [PAID, DEV],
  },
  {
    id: 20,
    group: "keywords",
    title: "Branded and non-branded traffic split",
    status: "missing",
    missing:
      "No split of Search Console clicks into brand searches and other searches.",
    unlocks: [GSC, DEV],
  },
  {
    id: 21,
    group: "keywords",
    title: "Seasonality",
    status: "partial",
    missing: "One monthly volume shows, not the 12 months.",
    unlocks: [DEV],
  },
  {
    id: 22,
    group: "keywords",
    title: "Search intent and conversion class per keyword",
    status: "planned",
    missing: "Keywords have no intent and conversion label yet.",
    unlocks: [OWNER],
  },
  {
    id: 23,
    group: "links",
    title: "Own backlink profile",
    status: "partial",
    missing: "Backlink counts show for competitors only.",
    unlocks: [PAID, DEV],
  },
  {
    id: 24,
    group: "links",
    title: "New and lost referring domains",
    status: "missing",
    missing: "No list of domains that started or stopped linking to the site.",
    unlocks: [PAID, DEV],
  },
  {
    id: 25,
    group: "links",
    title: "Link intersect",
    status: "missing",
    missing: "No list of domains that link to competitors but not to the site.",
    unlocks: [PAID, DEV],
  },
  {
    id: 26,
    group: "links",
    title: "Unlinked brand mentions",
    status: "missing",
    missing: "No search for pages that name the brand without a link.",
    unlocks: [PAID, DEV],
  },
  {
    id: 27,
    group: "links",
    title: "Anchor text profile",
    status: "missing",
    missing: "No view of the anchor texts of inbound links.",
    unlocks: [PAID, DEV],
  },
  {
    id: 28,
    group: "links",
    title: "Outreach tracker",
    status: "partial",
    missing:
      "Post texts can be copied, but pitches and won links are not tracked.",
    unlocks: [OWNER],
  },
  {
    id: 29,
    group: "local",
    title: "Business Profile connection",
    status: "missing",
    missing: "No connection to Google Business Profile.",
    unlocks: [OWNER],
  },
  {
    id: 30,
    group: "local",
    title: "Review monitoring and reply drafts",
    status: "missing",
    missing: "No list of new Google reviews and no reply drafts.",
    unlocks: [OWNER],
  },
  {
    id: 31,
    group: "local",
    title: "Local pack grid",
    status: "missing",
    missing: "No map pack rank at points around the business.",
    unlocks: [PAID, OWNER],
  },
  {
    id: 32,
    group: "measurement",
    title: "Search Console history past 16 months",
    status: "partial",
    missing:
      "A sync reads the last 90 days. No history is kept past 16 months.",
    unlocks: [GSC, OWNER],
  },
  {
    id: 33,
    group: "measurement",
    title: "Traffic and rank drop alerts",
    status: "missing",
    missing: "No alert when clicks, the index state or a rank drops.",
    unlocks: [DEV],
  },
  {
    id: 34,
    group: "measurement",
    title: "Google update markers on charts",
    status: "built",
    missing: null,
    unlocks: [],
  },
  {
    id: 35,
    group: "measurement",
    title: "Organic conversions per landing page",
    status: "partial",
    missing: "Key events and revenue per landing page do not show.",
    unlocks: ["ga4", "ga4_key_events", DEV],
  },
  {
    id: 36,
    group: "measurement",
    title: "Before and after impact per action",
    status: "partial",
    missing:
      "No clicks and position before and after a done action in the tab.",
    unlocks: [GSC, DEV],
  },
  {
    id: 37,
    group: "measurement",
    title: "Discover, News, Image and Video performance",
    status: "partial",
    missing: "Only web search is read, not Discover, News, Image or Video.",
    unlocks: [GSC, DEV],
  },
  {
    id: 38,
    group: "measurement",
    title: "Export and date presets",
    status: "partial",
    missing:
      "No comparison with the same period last year. The countries and devices, competitors and keyword ideas tables have no CSV download.",
    unlocks: [DEV],
  },
  {
    id: 39,
    group: "ai",
    title: "AI Overview citation history",
    status: "partial",
    missing: "The tab does not show if an AI Overview cites the site.",
    unlocks: [PAID, DEV],
  },
  {
    id: 40,
    group: "ai",
    title: "AI assistant referral traffic",
    status: "missing",
    missing: "No view of visits from AI assistants such as ChatGPT or Gemini.",
    unlocks: ["ga4", DEV],
  },
  {
    id: 41,
    group: "ai",
    title: "Brand mentions in LLM answers",
    status: "missing",
    missing: "No check if AI answers name the brand.",
    unlocks: [PAID, OWNER],
  },
  {
    id: 42,
    group: "workflow",
    title: "Apply fixes in the CMS or as a pull request",
    status: "missing",
    missing: "Fixes are not written to the CMS or sent as a pull request.",
    unlocks: [OWNER],
  },
  {
    id: 43,
    group: "workflow",
    title: "Weekly digest",
    status: "missing",
    missing: "No weekly email or message with the main changes.",
    unlocks: [OWNER],
  },
  {
    id: 44,
    group: "workflow",
    title: "Recheck and recrawl after a fix",
    status: "partial",
    missing: "No automatic recheck and index check after a fix is done.",
    unlocks: [OWNER],
  },
  {
    id: 45,
    group: "workflow",
    title: "Shareable client report",
    status: "missing",
    missing: "No read-only link or PDF of the audit for clients.",
    unlocks: [OWNER],
  },
];
