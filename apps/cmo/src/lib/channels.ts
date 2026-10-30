import { CMO_CHANNELS, type CmoChannelKey } from "@sokosumi/utils";

export type ChannelInfo = (typeof CMO_CHANNELS)[CmoChannelKey];
export type ChannelGroup = ChannelInfo["group"];

/** Keys older plans used, mapped to today's channels. */
const LEGACY: Record<string, CmoChannelKey> = {
  twitter: "x",
  website: "seo",
  blog: "seo",
  email: "newsletter",
  ads: "meta_ads",
  meta: "meta_ads",
  google: "google_ads",
};

/** The channel a plan's key means, or null when Cuso does not run it. */
export function channelKey(channel: string): CmoChannelKey | null {
  const key = channel.trim().toLowerCase();
  if (key in CMO_CHANNELS) return key as CmoChannelKey;
  return LEGACY[key] ?? null;
}

export function channelInfo(channel: string): ChannelInfo | null {
  const key = channelKey(channel);
  return key ? CMO_CHANNELS[key] : null;
}

/** "carousel" on LinkedIn reads "Carousel"; an unknown format reads as written. */
export function formatName(channel: string, format: string): string {
  const formats = channelInfo(channel)?.formats as
    | Record<string, { name: string }>
    | undefined;
  const known = formats?.[format.trim().toLowerCase()]?.name;
  return known ?? format.charAt(0).toUpperCase() + format.slice(1);
}

/** Whether this piece is a video Cuso makes. */
export function formatHasVideo(channel: string, format: string): boolean {
  const formats = channelInfo(channel)?.formats as
    | Record<string, { video?: boolean }>
    | undefined;
  return formats?.[format.trim().toLowerCase()]?.video ?? false;
}

/** Whether Cuso makes the image for this piece. */
export function formatHasImage(channel: string, format: string): boolean {
  const formats = channelInfo(channel)?.formats as
    | Record<string, { image: boolean }>
    | undefined;
  return formats?.[format.trim().toLowerCase()]?.image ?? false;
}

export const GROUP_NAMES: Record<ChannelGroup, string> = {
  social: "Social media",
  ads: "Ads",
  email: "Newsletter",
  search: "SEO",
};

/** What the owner does for each kind of channel, in one line. */
export const OWNER_PART: Record<ChannelInfo["owner"], string> = {
  connect: "Connect your account. Cuso posts for you.",
  ad_account:
    "Cuso writes and designs the ads. You connect your ad account, set the budget and launch them.",
  mailing_list:
    "Cuso writes every issue, ready to send. Add your mailing list so he writes for the people on it.",
  publish:
    "Cuso finds what to improve and writes it ready to paste. You publish it on your site.",
};

/** Social networks Cuso posts to once connected. */
export const POSTING_NETWORKS = (
  Object.entries(CMO_CHANNELS) as [CmoChannelKey, ChannelInfo][]
)
  .filter(
    ([, channel]) => channel.group === "social" && channel.status === "live",
  )
  .map(([key]) => key);

/** Channels coming soon, to show without offering them. */
export const SOON_CHANNELS = (
  Object.entries(CMO_CHANNELS) as [CmoChannelKey, ChannelInfo][]
)
  .filter(([, channel]) => channel.status === "soon")
  .map(([key, channel]) => ({ key, name: channel.name }));

/**
 * Networks whose comments Cuso answers in his daily run. Core reads and
 * replies through these only: LinkedIn shares no comments and X needs paid
 * search, so both are left out.
 */
export const COMMENT_REPLY_CHANNELS: readonly string[] = [
  "instagram",
  "facebook",
  "youtube",
];
