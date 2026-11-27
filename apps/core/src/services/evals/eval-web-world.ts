import type { ExaSearchResult } from "@/lib/soko-bot/exa";
import { cmoPathWebPages } from "./cmo-path/sites";
import { INVESTOR_FIXTURE, investorLine } from "./ownerbench/journeys";

/**
 * The web an eval lane sees. A benchmark turn must not depend on the live
 * internet or a search key: every web_fetch and web_search in an eval
 * workspace is answered from these pages, and nothing reaches the network.
 * An unknown address is a 404, so a run is the same every time.
 */
export interface EvalWebPage {
  url: string;
  title: string;
  text: string;
}

const YOUTUBE_VIDEO_ID = "omM89sE7Jpg";

const PAGES: readonly EvalWebPage[] = [
  {
    url: "https://www.sokosumi.com",
    title: "Sokosumi: hire AI agents for real work",
    text: [
      "Sokosumi is a marketplace where teams hire AI agents and Coworkers for real work.",
      "Post a Task, pick an agent or a Coworker for it, and follow its progress on your board. You pay in credits, only for the work that runs.",
      "Soko Bot is your assistant in Sokosumi: it keeps your board moving, follows up on Tasks, drafts posts and messages for your approval, and reports back in chat.",
      "Projects keep a team's Tasks, Files and chats together. Files you upload are searchable by your agents.",
      "Sign up free and get starter credits to try your first Task.",
    ].join("\n\n"),
  },
  {
    url: "https://cal.com/pricing",
    title: "Pricing | Cal.com",
    text: [
      "Simple pricing for scheduling.",
      "Free: $0 per month. For individuals: unlimited event types, unlimited bookings, calendar connections.",
      "Teams: $15 per user per month, billed yearly. Round-robin and collective events, routing forms, team workflows.",
      "Organizations: $37 per user per month, billed yearly. Sub-teams, admin controls, domain-wide settings.",
      "Enterprise: custom pricing. Contact sales.",
    ].join("\n\n"),
  },
  {
    url: `https://www.youtube.com/watch?v=${YOUTUBE_VIDEO_ID}`,
    title: "Routing forms: send every lead to the right person (Cal.com)",
    text: [
      "Description: A 6-minute walkthrough of routing forms. Ask two or three questions before a booking, then send each lead to the right teammate's calendar.",
      'Transcript (0:00): "Most teams lose good leads in the first minute, because the person who books the call is not the one who should take it."',
      'Transcript (1:20): "A routing form asks a few questions first: company size, what you need, where you are."',
      'Transcript (2:45): "Big companies go to sales, small teams book a demo, and support questions never land on a sales calendar."',
      'Transcript (4:10): "You set it up once. After that, every booking goes to the right person, with the answers already in the invite."',
      'Transcript (5:30): "Try it on your own booking page this week and watch how many calls stop being handed around."',
    ].join("\n"),
  },
  ...[...INVESTOR_FIXTURE.fits, ...INVESTOR_FIXTURE.misfits].map(
    (investor) => ({
      url: investor.source,
      title: `${investor.fund} | Padierfind investor notes`,
      text: investorLine(investor).replaceAll("**", ""),
    }),
  ),
];

/** One key per page however the bot writes its address. */
function pageKey(link: string): string | null {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^(www\.|m\.)/, "");
  if (host === "youtu.be")
    return `youtube.com/watch?v=${url.pathname.slice(1)}`;
  const path = url.pathname.replace(/\/+$/, "");
  const video = host === "youtube.com" ? url.searchParams.get("v") : null;
  return `${host}${path}${video ? `?v=${video}` : ""}`;
}

const BY_KEY = new Map(PAGES.map((page) => [pageKey(page.url), page]));

/**
 * The link preview a chat shows in an eval lane: the page's title and first
 * paragraph, with no image. An address the world lacks gets no preview.
 */
export function evalUnfurlCards(urls: readonly string[]) {
  return urls.flatMap((url) => {
    const page = BY_KEY.get(pageKey(url));
    if (!page) return [];
    return [
      {
        url,
        title: page.title,
        description: page.text.split("\n").find(Boolean) ?? null,
        imageUrl: null,
        siteName: new URL(page.url).hostname.replace(/^www\./, ""),
      },
    ];
  });
}

/** The owner's own profiles, as read_social_profile would see them. */
const PROFILES: readonly {
  url: string;
  network: string;
  followers: string;
  posts: string;
  recent: { date: string; title: string }[];
}[] = [
  {
    url: "https://x.com/padierfind",
    network: "x",
    followers: "850",
    posts: "214",
    recent: [
      {
        date: "2026-11-25",
        title:
          "Five seed funds backing AI agents in Europe this year, and what they look for.",
      },
      {
        date: "2026-11-21",
        title:
          "We moved our booking page to routing forms. Fewer calls get handed around.",
      },
    ],
  },
  {
    url: "https://www.linkedin.com/company/padierfind",
    network: "linkedin",
    followers: "1,240",
    posts: "57",
    recent: [
      {
        date: "2026-11-24",
        title: "What we learned hiring our first AI agent for research.",
      },
    ],
  },
  {
    url: "https://www.youtube.com/@padierfind",
    network: "youtube",
    followers: "312",
    posts: "9",
    recent: [
      {
        date: "2026-11-20",
        title: "Routing forms: send every lead to the right person (Cal.com)",
      },
    ],
  },
  {
    url: "https://www.instagram.com/padierfind",
    network: "instagram",
    followers: "640",
    posts: "88",
    recent: [
      { date: "2026-11-22", title: "Behind the scenes: our Monday plan." },
    ],
  },
];

const PROFILE_BY_KEY = new Map(
  PROFILES.map((profile) => [pageKey(profile.url), profile]),
);

/** read_social_profile in an eval lane: a fixed profile, or unreadable. */
export function evalSocialProfile(network: string, url: string) {
  const profile = PROFILE_BY_KEY.get(pageKey(url));
  if (!profile)
    return {
      network,
      url,
      recent: [],
      readable: false,
      note: "This profile could not be read right now; ask the owner what it shows.",
    };
  return {
    network: profile.network,
    url: profile.url,
    followers: profile.followers,
    posts: profile.posts,
    recent: profile.recent,
    readable: true,
  };
}

/** web_fetch in an eval lane: the page, or a 404 for an address it lacks. */
export function evalWebFetch(input: { url: string; maxChars?: number }) {
  const key = pageKey(input.url);
  const page =
    BY_KEY.get(key) ??
    cmoPathWebPages().find((candidate) => pageKey(candidate.url) === key);
  if (!page)
    return {
      url: input.url,
      status: 404,
      contentType: "text/plain",
      text: "Not found: this page does not exist.",
    };
  const text = `${page.title}\n\n${page.text}`;
  return {
    url: page.url,
    status: 200,
    contentType: "text/html",
    text: input.maxChars ? text.slice(0, input.maxChars) : text,
  };
}

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
}

/**
 * web_search in an eval lane: the pages sharing the most words with the
 * query, best first and then by address, so the same query always finds
 * the same results. A query that matches nothing finds nothing.
 */
export function evalWebSearch(
  query: string,
  numResults: number,
): ExaSearchResult["results"] {
  const wanted = words(query);
  return [...PAGES, ...cmoPathWebPages()]
    .map((page) => {
      const have = words(`${page.title} ${page.text}`);
      return { page, score: [...wanted].filter((w) => have.has(w)).length };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.page.url.localeCompare(b.page.url))
    .slice(0, numResults)
    .map(({ page }) => ({
      title: page.title,
      url: page.url,
      passages: page.text.split("\n").filter(Boolean).slice(0, 2),
    }));
}
