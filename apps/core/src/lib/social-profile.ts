import { ssrfSafeFetch } from "@sokosumi/net";

import { decodeEntities } from "@/lib/open-graph-html";
import { readPageText, withBrowser } from "@/lib/site-capture";

/** What a public social profile shows a visitor who is not signed in. */
export interface SocialProfile {
  network: string;
  url: string;
  /** As the network shows it: "511K", "4,078". */
  followers?: string;
  posts?: string;
  /** Recent posts, newest first, with their date when the page shows one. */
  recent: { date?: string; title: string }[];
  /** The visible text, for what the numbers do not say (themes, formats). */
  text?: string;
  /** False when the network shows nothing without signing in. */
  readable: boolean;
  note?: string;
}

const MAX_HTML_BYTES = 6_000_000;
/** Social sites serve link-preview metadata to this agent. */
const PREVIEW_AGENT =
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";
const BROWSER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const MAX_TEXT = 3_000;
const MAX_RECENT = 15;

export function socialNetworkOf(url: string): string | null {
  const host = URL.parse(url)?.hostname.replace(/^(www|m)\./, "") ?? "";
  if (host === "instagram.com") return "instagram";
  if (host === "youtube.com" || host === "youtu.be") return "youtube";
  if (host === "linkedin.com") return "linkedin";
  if (host === "x.com" || host === "twitter.com") return "x";
  if (host === "tiktok.com") return "tiktok";
  if (host === "facebook.com" || host === "fb.com") return "facebook";
  return null;
}

async function fetchHtml(url: string, agent: string): Promise<string> {
  const response = await ssrfSafeFetch(url, {
    maxResponseBytes: MAX_HTML_BYTES,
    headers: { "User-Agent": agent, "Accept-Language": "en-US,en;q=0.9" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function meta(html: string, name: string): string | undefined {
  const tag = [...html.matchAll(/<meta\b[^>]*>/gi)]
    .map((match) => match[0])
    .find((candidate) =>
      new RegExp(`(?:property|name)=["']${name}["']`, "i").test(candidate),
    );
  const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
  return content ? decodeEntities(content) : undefined;
}

/** "511K Followers, 357 Following, 402 Posts - See Instagram photos…" */
export function instagramCounts(description: string): {
  followers?: string;
  posts?: string;
} {
  return {
    followers: description.match(/([\d.,]+[KMB]?)\s+Followers/i)?.[1],
    posts: description.match(/([\d.,]+[KMB]?)\s+Posts/i)?.[1],
  };
}

async function readInstagram(url: string): Promise<SocialProfile> {
  const description = meta(
    await fetchHtml(url, PREVIEW_AGENT),
    "og:description",
  );
  const counts = description ? instagramCounts(description) : {};
  return {
    network: "instagram",
    url,
    ...counts,
    recent: [],
    readable: Boolean(counts.followers),
    note: "Instagram shows counts but not post dates without signing in; connect the account for its real cadence.",
  };
}

/** Menu labels YouTube also names "title" on its videos page. */
const YOUTUBE_UI_TITLES = new Set([
  "Add to queue",
  "Save to playlist",
  "Share",
  "Not interested",
  "Don't recommend channel",
  "Report",
]);

/**
 * A channel's latest uploads from its /videos page, newest first: titles and
 * how long ago each went up ("2 weeks ago").
 */
export function youtubeUploads(
  html: string,
): { date?: string; title: string }[] {
  const titles = [...html.matchAll(/"title":\{"content":"((?:[^"\\]|\\.)*)"/g)]
    .map((match) => decodeEntities(match[1] ?? ""))
    .filter((title) => title && !YOUTUBE_UI_TITLES.has(title));
  const ages = [
    ...html.matchAll(
      /"(\d{1,3} (?:second|minute|hour|day|week|month|year)s? ago)"/g,
    ),
  ].map((match) => match[1]);
  return titles
    .slice(0, MAX_RECENT)
    .map((title, index) => ({ title, date: ages[index] }));
}

async function readYouTube(url: string): Promise<SocialProfile> {
  const channel = url.replace(/\/(videos|featured|shorts|streams)\/?$/, "");
  const html = await fetchHtml(`${channel}/videos`, BROWSER_AGENT);
  const followers = (
    html.match(/"subscriberCountText":\{[^}]*?"simpleText":"([^"]+)"/)?.[1] ??
    html.match(/([\d.,]+[KMB]?) subscribers/)?.[1]
  )?.replace(/\s*subscribers?/i, "");
  const recent = youtubeUploads(html);
  return {
    network: "youtube",
    url,
    followers,
    recent,
    readable: Boolean(followers || recent.length),
  };
}

/** "18.3K Followers", "4,078 followers", "6,223 posts" in visible text. */
export function countsInText(text: string): {
  followers?: string;
  posts?: string;
} {
  return {
    followers: text.match(/([\d.,]+[KMB]?)\s+followers/i)?.[1],
    posts: text.match(/([\d.,]+[KMB]?)\s+posts/i)?.[1],
  };
}

/** X, LinkedIn and TikTok show a profile header and recent posts once rendered. */
async function readRendered(
  network: string,
  url: string,
): Promise<SocialProfile> {
  const text = await withBrowser((browser) => readPageText(browser, url));
  const counts = text ? countsInText(text) : {};
  const followers =
    counts.followers ??
    (network === "linkedin"
      ? meta(
          await fetchHtml(url, BROWSER_AGENT).catch(() => ""),
          "description",
        )?.match(/([\d.,]+[KMB]?) followers/i)?.[1]
      : undefined);
  return {
    network,
    url,
    followers,
    posts: counts.posts,
    recent: [],
    text: text?.slice(0, MAX_TEXT),
    readable: Boolean(followers || text),
  };
}

/**
 * Reads what a business's public social profile shows today: followers, post
 * count, recent posts and their dates where the network shows them, and the
 * visible text. Never signs in; a network that shows nothing says so.
 */
export async function readSocialProfile(url: string): Promise<SocialProfile> {
  const network = socialNetworkOf(url);
  if (!network) {
    return {
      network: "unknown",
      url,
      recent: [],
      readable: false,
      note: "Not a social network this tool reads; use web_fetch for websites and blogs.",
    };
  }
  try {
    if (network === "instagram") return await readInstagram(url);
    if (network === "youtube") return await readYouTube(url);
    if (network === "facebook") {
      return {
        network,
        url,
        recent: [],
        readable: false,
        note: "Facebook shows nothing without signing in; ask the owner, or connect the page.",
      };
    }
    return await readRendered(network, url);
  } catch {
    return {
      network,
      url,
      recent: [],
      readable: false,
      note: "The profile did not load.",
    };
  }
}
