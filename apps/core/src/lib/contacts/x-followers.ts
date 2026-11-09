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

/** The keys a follower is looked up by: first and last name, or a first name alone. */
export function followerNameKey(name: string): string | null {
  const parts = words(name);
  if (parts.length === 1) return `first:${parts[0]}`;
  return personNameKey(name);
}

/** The keys a contact can be found under by `followerNameKey`. */
export function contactNameKeys(name: string): string[] {
  const first = words(name)[0];
  return [personNameKey(name), first ? `first:${first}` : null].filter(
    (key): key is string => key !== null,
  );
}

/**
 * 0.5 for the same full name, 0.4 for the same first and last name, 0.3
 * for a follower who gives only a first name and that is the contact's.
 */
function nameScore(follower: XFollower, contact: MatchContact): number {
  const own = words(follower.name ?? "");
  const theirs = words(contact.name);
  if (own.length === 1) return own[0] === theirs[0] ? 0.3 : 0;
  const key = personNameKey(follower.name ?? "");
  if (!key || key !== personNameKey(contact.name)) return 0;
  return own.join(" ") === theirs.join(" ") ? 0.5 : 0.4;
}

function mentions(haystack: string, needle: string): boolean {
  const target = normalizePersonName(needle);
  if (target.length < 3) return false;
  return ` ${normalizePersonName(haystack)} `.includes(` ${target} `);
}

function initials(parts: readonly string[]): string {
  return parts.map((part) => part[0] ?? "").join("");
}

/**
 * The bio's tokens as written, with whether each stands out as a name: an
 * @handle, ALL CAPS, or CamelCase ("DraperU"), not an ordinary word.
 */
function bioTokens(
  bio: string,
): { word: string; marked: boolean; capital: boolean }[] {
  const plain = bio.normalize("NFKD").replace(/\p{M}/gu, "");
  return [...plain.matchAll(/(@?)([\p{L}\p{N}]+)/gu)].map(
    ([, at, raw = ""]) => ({
      word: raw.toLowerCase(),
      marked:
        at === "@" ||
        (raw.length > 1 && raw === raw.toUpperCase() && /\p{L}/u.test(raw)) ||
        /\p{Ll}\p{Lu}/u.test(raw),
      capital: /^\p{Lu}/u.test(raw),
    }),
  );
}

/**
 * Whether the bio names this company: its name as written (an @handle
 * counts), its initials written as a name ("IOG" for Input Output Group, or
 * "Input Output Group" spelled out for IOG), or a short form written as a
 * name ("DraperU" for Draper University or draperuniversity.com). Ordinary
 * words never stand in for a company: "I build models" is not IBM.
 */
export function namesCompany(
  bio: string,
  company: string,
  fromDomain = false,
): boolean {
  if (mentions(bio, company)) return true;
  const tokens = bioTokens(bio);
  const parts = words(company);
  const squashed = parts.join("").replace(/-/g, "");
  if (squashed.length < 3) return false;
  const shortForm = (token: { word: string; marked: boolean }) =>
    token.marked &&
    token.word.length >= 5 &&
    token.word.length < squashed.length &&
    squashed.startsWith(token.word) &&
    token.word.length >= (fromDomain ? 6 : (parts[0]?.length ?? 0) + 1);
  if (tokens.some(shortForm)) return true;
  if (fromDomain) return false;
  // "IOG" in the company, its words capitalized in a row in the bio.
  if (parts.length === 1 && squashed.length <= 6)
    return tokens.some((_, start) => {
      const run = tokens.slice(start, start + squashed.length);
      return (
        run.length === squashed.length &&
        run.every((token) => token.capital) &&
        initials(run.map((token) => token.word)) === squashed
      );
    });
  // "Input Output Group" in the company, "IOG" written as a name in the bio.
  return (
    parts.length >= 3 &&
    tokens.some(
      (token) =>
        token.marked &&
        token.word === initials(parts) &&
        token.word.length >= 3,
    )
  );
}

/**
 * Whether an organization is the company of an email domain: the same name,
 * or the domain is the name plus a company word ("acme" and "acmeinc").
 */
function sameCompany(organization: string, stem: string): boolean {
  if (organization.length < 3) return false;
  if (organization === stem) return true;
  return (
    stem.startsWith(organization) &&
    /^(inc|ltd|llc|gmbh|ag|hq|co|corp|group|labs|io|app|team)$/.test(
      stem.slice(organization.length),
    )
  );
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
  const domains = new Set<string>();
  for (const channel of contact.channels) {
    if (channel.type === "WEBSITE" && host && ownHost(channel.value) === host)
      evidence = Math.max(evidence, 0.5);
    if (channel.type === "EMAIL") {
      const domain = companyDomain(channel.value);
      if (domain && host === domain) evidence = Math.max(evidence, 0.3);
      if (domain) domains.add(domain.split(".")[0] ?? "");
    }
    if (
      channel.type === "LINKEDIN" &&
      slug &&
      linkedInSlug(channel.value) === slug
    )
      evidence = Math.max(evidence, 0.6);
  }
  const bio = follower.description;
  const companyNamed =
    (!!contact.organization && namesCompany(bio, contact.organization)) ||
    [...domains].some((stem) => namesCompany(bio, stem, true));
  // A first name alone needs the bio to name the company their address is
  // at: the domain itself, or an organization that is that domain's.
  if (name === 0.3) {
    const organization = contact.organization
      ? words(contact.organization).join("")
      : "";
    const atNamedCompany = [...domains].some(
      (stem) =>
        namesCompany(bio, stem, true) ||
        (!!contact.organization &&
          sameCompany(organization, stem) &&
          namesCompany(bio, contact.organization)),
    );
    return atNamedCompany ? AUTO_MERGE_SCORE : 0;
  }
  let score = name + evidence;
  if (companyNamed) score += 0.25;
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
