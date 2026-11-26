import type { VideoShape } from "./video-recipes.js";

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
      talking_video: {
        name: "Talking video",
        what: "A presenter speaks a short script to camera, with captions",
        image: false,
        video: true,
        talking: true,
      },
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
        slides: [2, 4],
      },
      video: {
        name: "Video",
        what: "A five-second vertical video made from a brand picture, with a caption",
        image: false,
        video: true,
      },
      wide_video: {
        name: "Widescreen video",
        what: "The month's talking video or short in 16:9, for LinkedIn on a desktop",
        image: false,
        video: true,
        shape: "16:9",
        gate: "cmo-video-shapes",
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
        name: "Thread",
        what: "A post plus a first reply with the link or the next point",
        image: false,
      },
      image: {
        name: "Image post",
        what: "A post with an image Cuso makes",
        image: true,
      },
      video: {
        name: "Video post",
        what: "The month's talking video or short in 16:9, posted on X",
        image: false,
        video: true,
        shape: "16:9",
        gate: "cmo-video-shapes",
      },
    },
  },
  facebook: {
    name: "Facebook",
    group: "social",
    status: "live",
    owner: "connect",
    formats: {
      talking_video: {
        name: "Talking Reel",
        what: "A presenter speaks a short script to camera, with captions",
        image: false,
        video: true,
        talking: true,
      },
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
        what: "A five-second vertical video made from a brand picture",
        image: false,
        video: true,
      },
      feed_video: {
        name: "Feed video",
        what: "The month's talking video or short in 4:5, for the feed",
        image: false,
        video: true,
        shape: "4:5",
        gate: "cmo-video-shapes",
      },
    },
  },
  instagram: {
    name: "Instagram",
    group: "social",
    status: "live",
    owner: "connect",
    formats: {
      talking_video: {
        name: "Talking Reel",
        what: "A presenter speaks a short script to camera, with captions",
        image: false,
        video: true,
        talking: true,
      },
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
      carousel: {
        name: "Carousel",
        what: "Three to ten slides people swipe through and save",
        image: true,
        slides: [3, 10],
      },
      reel: {
        name: "Reel",
        what: "A five-second vertical video made from a brand picture",
        image: false,
        video: true,
      },
      feed_video: {
        name: "Feed video",
        what: "The month's talking video or short in 4:5, for the feed and the grid",
        image: false,
        video: true,
        shape: "4:5",
        gate: "cmo-video-shapes",
      },
    },
  },
  youtube: {
    name: "YouTube",
    group: "social",
    status: "live",
    owner: "connect",
    formats: {
      talking_video: {
        name: "Talking YouTube Short",
        what: "A presenter speaks a short script to camera, with captions",
        image: false,
        video: true,
        talking: true,
      },
      short: {
        name: "YouTube Short",
        what: "A five-second vertical video made from a brand picture, with a title",
        image: false,
        video: true,
      },
      video: {
        name: "YouTube video",
        what: "The month's talking video or short in 16:9, a normal video with a thumbnail",
        image: false,
        video: true,
        shape: "16:9",
        gate: "cmo-video-shapes",
      },
    },
  },
  tiktok: {
    name: "TikTok",
    group: "social",
    status: "live",
    owner: "connect",
    formats: {
      talking_video: {
        name: "Talking TikTok",
        what: "A presenter speaks a short script to camera, with captions",
        image: false,
        video: true,
        talking: true,
      },
      video: {
        name: "TikTok",
        what: "A five-second vertical video made from a brand picture, with a caption",
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
        slides: [2, 10],
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
    // Articles and page changes live in CMO's SEO tab, never in the strategy calendar.
    status: "tab",
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
    /** live: planned in the strategy; soon: not yet; tab: run from its own tab, never planned in the calendar. */
    status: "live" | "soon" | "tab";
    /** What the owner does: connect the account, connect an ad account, add a mailing list, or publish SEO changes. */
    owner: "connect" | "ad_account" | "mailing_list" | "publish";
    formats: Record<
      string,
      {
        name: string;
        what: string;
        image: boolean;
        video?: boolean;
        /** A presenter speaks the piece's script: a talking video. */
        talking?: boolean;
        /** A multi-image format: the fewest and most slides it takes. */
        slides?: readonly [number, number];
        /** The shape a video format is posted in; vertical when not given. */
        shape?: VideoShape;
        /**
         * The version skill that offers this format. Without it the format is
         * in no menu and no plan; with it, only as a copy of a video (alsoOn).
         */
        gate?: typeof CMO_VIDEO_SHAPES_SKILL;
      }
    >;
  }
>;
export type CmoChannelKey = keyof typeof CMO_CHANNELS;

/**
 * The version skill that lets a Cuso post the month's videos in other shapes
 * (`CMO_SHAPED_VIDEO_TARGETS`). Default off; a version lists it to opt in.
 */
export const CMO_VIDEO_SHAPES_SKILL = "cmo-video-shapes";

interface ChannelFormat {
  name: string;
  what: string;
  video?: boolean;
  shape?: VideoShape;
  gate?: string;
}

function channelFormats(channel: string): Record<string, ChannelFormat> {
  return (
    (
      CMO_CHANNELS as Record<string, { formats: Record<string, ChannelFormat> }>
    )[channel]?.formats ?? {}
  );
}

/** Whether a format is only ever a video's copy in another shape. */
export function isCmoShapedVideoFormat(
  channel: string,
  format: string,
): boolean {
  return Boolean(channelFormats(channel)[format]?.gate);
}

/** The formats a plan may name on a channel: every one no skill gates. */
export function cmoOfferedFormats(channel: string): string[] {
  return Object.entries(channelFormats(channel))
    .filter(([, format]) => !format.gate)
    .map(([key]) => key);
}

/**
 * Where a video can also go out in another shape, for a version with
 * `CMO_VIDEO_SHAPES_SKILL`: each a name a talking video's or short's
 * `alsoOn` may list, the network and format its copy post takes, and its
 * shape. Core cuts the shape from the same video, at no extra cost.
 */
export const CMO_SHAPED_VIDEO_TARGETS = {
  x: { channel: "x", format: "video" },
  instagram_feed: { channel: "instagram", format: "feed_video" },
  facebook_feed: { channel: "facebook", format: "feed_video" },
  youtube_video: { channel: "youtube", format: "video" },
  linkedin_wide: { channel: "linkedin", format: "wide_video" },
} as const satisfies Record<string, { channel: CmoChannelKey; format: string }>;
export type CmoShapedVideoTarget = keyof typeof CMO_SHAPED_VIDEO_TARGETS;

/** The shaped-video target an `alsoOn` name means, or null. */
export function cmoShapedVideoTarget(
  name: string,
): (typeof CMO_SHAPED_VIDEO_TARGETS)[CmoShapedVideoTarget] | null {
  return (
    (
      CMO_SHAPED_VIDEO_TARGETS as Record<
        string,
        (typeof CMO_SHAPED_VIDEO_TARGETS)[CmoShapedVideoTarget]
      >
    )[name] ?? null
  );
}

/**
 * Networks whose rules ask the account's owner to confirm each post: Cuso
 * makes the post and it waits for the owner's tap; nothing goes out on a
 * schedule. TikTok requires the creator's consent per video.
 */
export const CMO_OWNER_CONFIRMED_CHANNELS: readonly string[] = ["tiktok"];

/** Whether every post on this network waits for the owner's own confirmation. */
export function isCmoOwnerConfirmedChannel(channel: string): boolean {
  return CMO_OWNER_CONFIRMED_CHANNELS.includes(channel);
}

/**
 * Whether a plan may use this channel and format today. A gated format is
 * never a plan's own entry: it is only made as a copy of a video.
 */
export function isCmoChannelFormat(channel: string, format: string): boolean {
  const entry = (
    CMO_CHANNELS as Record<string, (typeof CMO_CHANNELS)[CmoChannelKey]>
  )[channel];
  return Boolean(
    entry &&
      entry.status === "live" &&
      cmoOfferedFormats(channel).includes(format),
  );
}

/**
 * The networks one short video goes out on together (owner, 2026-11-22:
 * "made once and posted to TikTok, Instagram Reels and YouTube Shorts"),
 * each with its own short-video format.
 */
export const CMO_SHORT_VIDEO_FORMATS = {
  tiktok: "video",
  instagram: "reel",
  youtube: "short",
} as const;

/** The short-video format of a network that shares short videos, or null. */
export function cmoShortVideoFormat(network: string): string | null {
  return (
    (CMO_SHORT_VIDEO_FORMATS as Record<string, string>)[
      network.toLowerCase()
    ] ?? null
  );
}

/** Whether a piece is a short video that goes out on the other short-video networks. */
export function isCmoShortVideoFormat(
  channel: string,
  format: string,
): boolean {
  return cmoShortVideoFormat(channel) === format;
}

/**
 * The shape a network shows a video piece in: a shaped format's own, else
 * vertical for Reels, Shorts and TikTok, and 4:5 on LinkedIn, whose feed
 * shows a 4:5 video larger than a vertical one on a desktop and as large on
 * a phone (its own video guide).
 */
export function cmoVideoShape(channel: string, format: string): VideoShape {
  return (
    channelFormats(channel)[format]?.shape ??
    (channel === "linkedin" ? "4:5" : "9:16")
  );
}

/** Whether a format is a talking video: a presenter speaking a script. */
export function isCmoTalkingFormat(channel: string, format: string): boolean {
  const entry = (
    CMO_CHANNELS as Record<
      string,
      { formats: Record<string, { talking?: boolean }> }
    >
  )[channel];
  return Boolean(entry?.formats[format]?.talking);
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
  const offered = cmoOfferedFormats(key);
  if (offered.includes(raw)) return { channel: key, format: raw };
  const pick = (...candidates: string[]) =>
    candidates.find((candidate) => offered.includes(candidate));
  const guess =
    (/fix|meta|title/.test(raw) && pick("page_fix")) ||
    (/search/.test(raw) && pick("search_ad")) ||
    (/display|banner/.test(raw) && pick("display_ad")) ||
    (/carousel|slide|album|images/.test(raw) &&
      pick("carousel", "carousel_ad", "images")) ||
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
