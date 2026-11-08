/**
 * X followers as contacts: who is a real person worth adding, and which
 * existing contact a follower already is. A follower is matched to a contact
 * only when the evidence is strong (`AUTO_MERGE_SCORE`); weaker matches are
 * created as their own contact, where the same-name duplicate check offers
 * the merge to a person.
 */
import { normalizeContactChannelValue } from "@sokosumi/utils";
import { companyDomain } from "./capture-filters";
import { normalizePersonName } from "./merge-rules";

export interface XFollower {
  id: string;
  username: string;
  name: string | null;
  description: string;
  location: string;
  /** The profile's link, expanded from t.co. */
  website: string | null;
  avatarUrl: string | null;
  defaultAvatar: boolean;
  protected: boolean;
  followers: number | null;
  following: number | null;
  posts: number | null;
}

/** The user fields a followers page asks X for. */
export const X_FOLLOWER_FIELDS = [
  "name",
  "username",
  "description",
  "location",
  "url",
  "entities",
  "profile_image_url",
  "protected",
  "public_metrics",
];

function field(value: unknown, key: string): unknown {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function count(value: unknown, key: string): number | null {
  const found = field(value, key);
  return typeof found === "number" ? found : null;
}

/** The profile link, preferring the expanded form over the t.co short link. */
function websiteOf(user: unknown): string | null {
  const urls = field(field(field(user, "entities"), "url"), "urls");
  const expanded = Array.isArray(urls)
    ? urls.map((entry) => text(field(entry, "expanded_url"))).find(Boolean)
    : undefined;
  return expanded || text(field(user, "url")) || null;
}

export function parseXFollower(raw: unknown): XFollower | null {
  const id = text(field(raw, "id"));
  const username = text(field(raw, "username"));
  if (!id || !username) return null;
  const image = text(field(raw, "profile_image_url"));
  const metrics = field(raw, "public_metrics");
  return {
    id,
    username,
    name: text(field(raw, "name")) || null,
    description: text(field(raw, "description")),
    location: text(field(raw, "location")),
    website: websiteOf(raw),
    // `_normal` is 48px; the same image comes larger without the suffix.
    avatarUrl: image ? image.replace("_normal.", "_400x400.") : null,
    defaultAvatar: !image || image.includes("default_profile"),
    protected: field(raw, "protected") === true,
    followers: count(metrics, "followers_count"),
    following: count(metrics, "following_count"),
    posts: count(metrics, "tweet_count"),
  };
}

/** Empty, silent or follow-spam accounts: mostly bots, never worth a row. */
export function isLikelyBot(follower: XFollower): boolean {
  const silent = !follower.description;
  if (silent && (follower.defaultAvatar || follower.protected)) return true;
  if (follower.posts === 0 && (follower.followers ?? 0) < 5) return true;
  const { followers, following } = follower;
  return (
    following !== null &&
    followers !== null &&
    following > 1_000 &&
    followers * 20 < following
  );
}

/** Link hosts that say nothing about who someone is. */
const SHARED_HOSTS = new Set([
  "beacons.ai",
  "bento.me",
  "bit.ly",
  "calendly.com",
  "facebook.com",
  "github.com",
  "instagram.com",
  "linkedin.com",
  "linktr.ee",
  "medium.com",
  "substack.com",
  "t.co",
  "tiktok.com",
  "twitter.com",
  "x.com",
  "youtu.be",
  "youtube.com",
]);

/** `https://acme.com/team` → "acme.com", for a link that belongs to someone. */
export function ownHost(url: string | null): string | null {
  if (!url) return null;
  const site = normalizeContactChannelValue("WEBSITE", url);
  const host = site ? new URL(site).hostname.replace(/^www\./, "") : null;
  if (!host?.includes(".")) return null;
  const shared = [...SHARED_HOSTS].some(
    (service) => host === service || host.endsWith(`.${service}`),
  );
  return shared ? null : host;
}

function linkedInSlug(value: string): string | null {
  return (
    /linkedin\.com\/in\/([^/?#\s]+)/i.exec(value)?.[1]?.toLowerCase() ?? null
  );
}

export interface MatchContact {
  id: string;
  name: string;
  organization: string | null;
  location: string | null;
  channels: readonly { type: string; value: string }[];
}

function words(value: string): string[] {
  return normalizePersonName(value).split(" ").filter(Boolean);
}

/** "Nina M. Keller" → "nina keller": who can be the same person at all. */
export function personNameKey(name: string): string | null {
  const parts = words(name);
  return parts.length < 2 ? null : `${parts[0]} ${parts.at(-1)}`;
}

/** 0.5 for the same full name, 0.4 for the same first and last name. */
function nameScore(follower: XFollower, contact: MatchContact): number {
  const key = personNameKey(follower.name ?? "");
  if (!key || key !== personNameKey(contact.name)) return 0;
  return words(follower.name ?? "").join(" ") === words(contact.name).join(" ")
    ? 0.5
    : 0.4;
}

function mentions(haystack: string, needle: string): boolean {
  const target = normalizePersonName(needle);
  if (target.length < 3) return false;
  return ` ${normalizePersonName(haystack)} `.includes(` ${target} `);
}

/**
 * How sure we are that the follower is this contact, from 0 to about 1.6:
 * the name, plus their own website, a LinkedIn profile, the company in
 * their bio, and the city.
 */
export function followerMatchScore(
  follower: XFollower,
  contact: MatchContact,
): number {
  const name = nameScore(follower, contact);
  const host = ownHost(follower.website);
  const slug = linkedInSlug(
    `${follower.website ?? ""} ${follower.description}`,
  );
  let evidence = 0;
  const companyNames = new Set<string>();
  if (contact.organization) companyNames.add(contact.organization);
  for (const channel of contact.channels) {
    if (channel.type === "WEBSITE" && host && ownHost(channel.value) === host)
      evidence = Math.max(evidence, 0.5);
    if (channel.type === "EMAIL") {
      const domain = companyDomain(channel.value);
      if (domain && host === domain) evidence = Math.max(evidence, 0.3);
      if (domain) companyNames.add(domain.split(".")[0] ?? "");
    }
    if (
      channel.type === "LINKEDIN" &&
      slug &&
      linkedInSlug(channel.value) === slug
    )
      evidence = Math.max(evidence, 0.6);
  }
  let score = name + evidence;
  if (
    [...companyNames].some((company) => mentions(follower.description, company))
  )
    score += 0.25;
  const city = (contact.location ?? "").split(/[,/(]/)[0] ?? "";
  if (follower.location && mentions(follower.location, city)) score += 0.15;
  return score;
}

/** The certainty from which a follower joins an existing contact. */
export const AUTO_MERGE_SCORE = 0.75;

/**
 * The one contact the follower certainly is: the name matches and something
 * else does too, and no other contact comes close.
 */
export function matchFollower(
  follower: XFollower,
  contacts: readonly MatchContact[],
): { contactId: string; score: number } | null {
  const scored = contacts
    .filter((contact) => nameScore(follower, contact) > 0)
    .map((contact) => ({
      contactId: contact.id,
      score: followerMatchScore(follower, contact),
    }))
    .filter(({ score }) => score >= AUTO_MERGE_SCORE)
    .sort((a, b) => b.score - a.score);
  return scored.length === 1 ? (scored[0] ?? null) : null;
}
