/**
 * Every channel Cuso works on, what he makes there and what the owner does.
 * The single source for his strategy skill, the save check and CMO's pages:
 * a plan may only use live channels and their formats.
 */
export const CMO_CHANNELS = {
  linkedin: {
    name: "LinkedIn",
    group: "social",
    status: "live",
    owner: "connect",
    formats: {
      post: {
        name: "Text post",
        what: "A short story or lesson in your voice",
        image: false,
      },
      image: {
        name: "Image post",
        what: "A post with an image Cuso makes",
        image: true,
      },
      images: {
        name: "Multi-image post",
        what: "Two to four images that tell one story",
        image: true,
      },
      video: {
        name: "Short video",
        what: "A vertical 10 to 15 second video Cuso makes, with a caption",
        image: false,
        video: true,
      },
    },
  },
  x: {
    name: "X",
    group: "social",
    status: "live",
    owner: "connect",
    formats: {
      post: {
        name: "Post",
        what: "One sharp thought in a line or two",
        image: false,
      },
      reply: {
        name: "Post with a reply",
        what: "A post plus a first reply with the link or the next point",
        image: false,
      },
      image: {
        name: "Image post",
        what: "A post with an image Cuso makes",
        image: true,
      },
    },
  },
  facebook: {
    name: "Facebook",
    group: "social",
    status: "live",
    owner: "connect",
    formats: {
      image: {
        name: "Image post",
        what: "A post with an image Cuso makes",
        image: true,
      },
      link: {
        name: "Link post",
        what: "A post that sends people to your site",
        image: true,
      },
      reel: {
        name: "Reel",
        what: "A vertical 10 to 15 second video Cuso makes",
        image: false,
        video: true,
      },
    },
  },
  instagram: {
    name: "Instagram",
    group: "social",
    status: "live",
    owner: "connect",
    formats: {
      image: {
        name: "Image post",
        what: "One strong image with a caption",
        image: true,
      },
      quote_card: {
        name: "Quote image",
        what: "A branded card with one line people save and share",
        image: true,
      },
      reel: {
        name: "Reel",
        what: "A vertical 10 to 15 second video Cuso makes",
        image: false,
        video: true,
      },
    },
  },
  youtube: {
    name: "YouTube",
    group: "social",
    status: "live",
    owner: "connect",
    formats: {
      short: {
        name: "YouTube Short",
        what: "A vertical 10 to 15 second video Cuso makes, with a title",
        image: false,
        video: true,
      },
    },
  },
  tiktok: {
    name: "TikTok",
    group: "social",
    status: "soon",
    owner: "connect",
    formats: {
      video: {
        name: "Short video",
        what: "Coming soon",
        image: false,
        video: true,
      },
    },
  },
  meta_ads: {
    name: "Facebook & Instagram ads",
    group: "ads",
    status: "live",
    owner: "ad_account",
    formats: {
      image_ad: {
        name: "Image ad",
        what: "An ad for Facebook and Instagram, image included",
        image: true,
      },
      carousel_ad: {
        name: "Swipe-through ad",
        what: "Several cards, each with its own image and line",
        image: true,
      },
    },
  },
  google_ads: {
    name: "Google Ads",
    group: "ads",
    status: "live",
    owner: "ad_account",
    formats: {
      search_ad: {
        name: "Search ad",
        what: "Headlines and descriptions for people searching for you",
        image: false,
      },
      display_ad: {
        name: "Image ad on websites",
        what: "An image ad across Google's sites",
        image: true,
      },
    },
  },
  newsletter: {
    name: "Newsletter",
    group: "email",
    status: "live",
    owner: "mailing_list",
    formats: {
      issue: {
        name: "Newsletter email",
        what: "A subject line and a short email for your list",
        image: false,
      },
    },
  },
  seo: {
    name: "Google search (SEO)",
    group: "search",
    status: "live",
    owner: "publish",
    formats: {
      page_fix: {
        name: "Page fix",
        what: "A better title, description or heading for a page, ready to paste",
        image: false,
      },
      article: {
        name: "Article",
        what: "A new page or article people search for, written in full",
        image: false,
      },
    },
  },
} as const satisfies Record<
  string,
  {
    name: string;
    group: "social" | "ads" | "email" | "search";
    status: "live" | "soon";
    /** What the owner does: connect the account, connect an ad account, add a mailing list, or publish SEO changes. */
    owner: "connect" | "ad_account" | "mailing_list" | "publish";
    formats: Record<
      string,
      { name: string; what: string; image: boolean; video?: boolean }
    >;
  }
>;
export type CmoChannelKey = keyof typeof CMO_CHANNELS;

/** Whether a plan may use this channel and format today. */
export function isCmoChannelFormat(channel: string, format: string): boolean {
  const entry = (
    CMO_CHANNELS as Record<string, (typeof CMO_CHANNELS)[CmoChannelKey]>
  )[channel];
  return Boolean(entry && entry.status === "live" && format in entry.formats);
}

/** Channel keys older plans or people use, mapped to today's channels. */
const CHANNEL_ALIASES: Record<string, CmoChannelKey> = {
  twitter: "x",
  website: "seo",
  blog: "seo",
  email: "newsletter",
  ads: "meta_ads",
  meta: "meta_ads",
  facebook_ads: "meta_ads",
  instagram_ads: "meta_ads",
  google: "google_ads",
};

/**
 * The catalog channel and format an entry means: aliases and older format
 * names map to today's ("website"/"article" to seo/article, "thread" to
 * reply, "carousel" to the channel's multi-image format). Unknown channels
 * stay as written, so the save check can name them.
 */
export function normalizeCmoChannelFormat(
  channel: string,
  format: string,
): { channel: string; format: string } {
  const rawChannel = channel.trim().toLowerCase();
  const raw = format
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const key = (
    rawChannel in CMO_CHANNELS ? rawChannel : CHANNEL_ALIASES[rawChannel]
  ) as CmoChannelKey | undefined;
  if (!key) return { channel: rawChannel, format: raw };
  const formats = Object.keys(CMO_CHANNELS[key].formats);
  if (formats.includes(raw)) return { channel: key, format: raw };
  const pick = (...candidates: string[]) =>
    candidates.find((candidate) => formats.includes(candidate));
  const guess =
    (/fix|meta|title/.test(raw) && pick("page_fix")) ||
    (/search/.test(raw) && pick("search_ad")) ||
    (/display|banner/.test(raw) && pick("display_ad")) ||
    (/carousel|slide|album|images/.test(raw) &&
      pick("carousel_ad", "images")) ||
    (/thread|reply/.test(raw) && pick("reply", "post")) ||
    (/quote/.test(raw) && pick("quote_card", "image")) ||
    (/link/.test(raw) && pick("link")) ||
    (/video|reel|short|clip/.test(raw) && pick("reel", "short", "video")) ||
    (/image|photo|graphic|visual/.test(raw) &&
      pick("image", "image_ad", "display_ad")) ||
    (/article|blog|guide/.test(raw) && pick("article")) ||
    (/news|issue|email/.test(raw) && pick("issue")) ||
    (/^(text|post|status|update)$/.test(raw) && pick("post")) ||
    (/^ads?$/.test(raw) && pick("image_ad", "search_ad"));
  return { channel: key, format: guess || raw };
}
