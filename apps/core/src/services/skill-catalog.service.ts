import { waitUntil } from "@vercel/functions";

import prisma from "@/lib/db/prisma";
import {
  discoverSkills,
  parseSkillFrontmatter,
  parseSkillSource,
  rawFile,
  SokoBotSkillError,
  searchSkillsSh,
} from "@/services/soko-bot-skills.service";

const SKILLS_SH = "https://www.skills.sh";
const FETCH_TIMEOUT_MS = 15_000;
const CATALOG_SIZE = 500;
const DESCRIPTION_CONCURRENCY = 6;
const STALE_ENTRY_MS = 30 * 24 * 60 * 60 * 1_000;
const MARKDOWN_TTL_MS = 24 * 60 * 60 * 1_000;
const SEARCH_LIMIT = 20;
const LIVE_SEARCH_BELOW = 5;
const STALE_CATALOG_MS = 2 * 24 * 60 * 60 * 1_000;
const LEADERBOARD_CACHE_MS = 60 * 60 * 1_000;
const BACKGROUND_REFRESH_MS = 60_000;

export const MAX_SKILLS_PER_MESSAGE = 3;
export const MAX_SKILL_CONTENT_CHARS = 50_000;

export interface LeaderboardEntry {
  id: string;
  source: string;
  name: string;
  installs: number;
}

export interface SkillCatalogItem {
  id: string;
  name: string;
  source: string;
  description: string | null;
  installs: number;
}

export interface ResolvedSkill {
  id: string;
  name: string;
  description: string | null;
  url: string;
  content: string;
}

function skillsShHeaders() {
  return {
    "user-agent": "Mozilla/5.0 (compatible; sokosumi-soko-bot)",
    accept: "text/html",
  };
}

/**
 * The leaderboard rows skills.sh embeds in its homepage payload, most
 * installed first. Each row appears in the page's flight data as escaped JSON.
 */
export function parseLeaderboard(html: string): LeaderboardEntry[] {
  const seen = new Map<string, LeaderboardEntry>();
  for (const match of html.matchAll(
    /\\"source\\":\\"([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\\",\\"skillId\\":\\"([A-Za-z0-9_.:-]+)\\",\\"name\\":\\"([^"\\]+)\\",\\"installs\\":(\d+)/g,
  )) {
    const [, source, skillId, name, installs] = match;
    const id = `${source}/${skillId}`;
    if (!seen.has(id))
      seen.set(id, { id, source, name, installs: Number(installs) });
  }
  return [...seen.values()].sort((a, b) => b.installs - a.installs);
}

function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** The one-line description skills.sh shows on a skill's page. */
export function parseSkillPageDescription(html: string): string | null {
  const match = html.match(/<meta name="description" content="([^"]*)"/);
  const description = match ? decodeEntities(match[1]).trim() : "";
  return description || null;
}

async function fetchSkillDescription(id: string): Promise<string | null> {
  const response = await fetch(`${SKILLS_SH}/${id}`, {
    headers: skillsShHeaders(),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  return parseSkillPageDescription(await response.text());
}

async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  const response = await fetch(`${SKILLS_SH}/`, {
    headers: skillsShHeaders(),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new SokoBotSkillError("skills.sh is unavailable");
  const entries = parseLeaderboard(await response.text()).slice(
    0,
    CATALOG_SIZE,
  );
  if (entries.length === 0)
    throw new SokoBotSkillError("Could not read the skills.sh leaderboard");
  return entries;
}

/**
 * Re-reads the skills.sh leaderboard into the catalog. Descriptions are
 * fetched once per skill, from its page, while the run has time left.
 */
export async function refreshSkillCatalog(options: {
  shouldContinue: () => boolean;
}): Promise<{ entries: number; described: number }> {
  const entries = await fetchLeaderboard();
  const refreshedAt = new Date();
  await prisma.$transaction([
    prisma.skillCatalogEntry.updateMany({ data: { rank: null } }),
    ...entries.map((entry, index) =>
      prisma.skillCatalogEntry.upsert({
        where: { id: entry.id },
        create: { ...entry, rank: index + 1, refreshedAt },
        update: {
          source: entry.source,
          name: entry.name,
          installs: entry.installs,
          rank: index + 1,
          refreshedAt,
        },
      }),
    ),
    prisma.skillCatalogEntry.deleteMany({
      where: {
        refreshedAt: { lt: new Date(refreshedAt.getTime() - STALE_ENTRY_MS) },
      },
    }),
  ]);

  const undescribed = await prisma.skillCatalogEntry.findMany({
    where: { description: null, rank: { not: null } },
    orderBy: { rank: "asc" },
    select: { id: true },
  });
  let described = 0;
  for (
    let start = 0;
    start < undescribed.length && options.shouldContinue();
    start += DESCRIPTION_CONCURRENCY
  ) {
    const batch = undescribed.slice(start, start + DESCRIPTION_CONCURRENCY);
    await Promise.all(
      batch.map(async ({ id }) => {
        const description = await fetchSkillDescription(id).catch(() => null);
        if (!description) return;
        await prisma.skillCatalogEntry.update({
          where: { id },
          data: { description },
        });
        described += 1;
      }),
    );
  }
  return { entries: entries.length, described };
}

let leaderboardCache: { at: number; entries: LeaderboardEntry[] } | null = null;
let backgroundRefresh: Promise<void> | null = null;

/** The live leaderboard, kept for an hour, for while the catalog is empty. */
async function cachedLeaderboard(): Promise<LeaderboardEntry[]> {
  if (
    !leaderboardCache ||
    Date.now() - leaderboardCache.at > LEADERBOARD_CACHE_MS
  )
    leaderboardCache = { at: Date.now(), entries: await fetchLeaderboard() };
  return leaderboardCache.entries;
}

/** Fills an empty or stale catalog without making the picker wait for it. */
function refreshInBackground(): void {
  if (backgroundRefresh) return;
  const deadline = Date.now() + BACKGROUND_REFRESH_MS;
  backgroundRefresh = refreshSkillCatalog({
    shouldContinue: () => Date.now() < deadline,
  })
    .then(() => undefined)
    .catch((error: unknown) => {
      console.warn("[skill-catalog] Background refresh failed", error);
    })
    .finally(() => {
      backgroundRefresh = null;
    });
  if (process.env.VERCEL) waitUntil(backgroundRefresh);
}

const CATALOG_SELECT = {
  id: true,
  name: true,
  source: true,
  description: true,
  installs: true,
} as const;

/**
 * The most installed skills. Until the daily sync has filled the catalog,
 * or once it has gone stale, a refresh starts; an empty catalog is answered
 * from the live leaderboard meanwhile.
 */
async function topSkills(): Promise<SkillCatalogItem[]> {
  const rows = await prisma.skillCatalogEntry.findMany({
    where: { rank: { not: null } },
    orderBy: [{ installs: "desc" }, { id: "asc" }],
    take: SEARCH_LIMIT,
    select: { ...CATALOG_SELECT, refreshedAt: true },
  });
  const newest = Math.max(0, ...rows.map((row) => row.refreshedAt.getTime()));
  if (Date.now() - newest > STALE_CATALOG_MS) refreshInBackground();
  if (rows.length > 0) return rows.map(({ refreshedAt: _, ...item }) => item);
  const live = await cachedLeaderboard().catch(() => []);
  return live.slice(0, SEARCH_LIMIT).map(({ id, name, source, installs }) => ({
    id,
    name,
    source,
    installs,
    description: null,
  }));
}

/** Only results that contain the query; name matches first, then by installs. */
function rankSkillMatches(
  items: readonly SkillCatalogItem[],
  query: string,
): SkillCatalogItem[] {
  const q = query.toLowerCase();
  const inName = (item: SkillCatalogItem) =>
    item.name.toLowerCase().includes(q);
  return items
    .filter(
      (item) =>
        inName(item) ||
        item.id.toLowerCase().includes(q) ||
        (item.description?.toLowerCase().includes(q) ?? false),
    )
    .sort(
      (a, b) =>
        Number(inName(b)) - Number(inName(a)) ||
        b.installs - a.installs ||
        a.id.localeCompare(b.id),
    );
}

/**
 * Catalog search for the chat skill picker. A query the top skills do not
 * cover falls back to skills.sh's own search, which matches loosely, so only
 * results that contain the query are kept.
 */
export async function searchSkillCatalog(
  query: string,
): Promise<SkillCatalogItem[]> {
  const q = query.trim().slice(0, 100);
  if (!q) return topSkills();
  const local = await prisma.skillCatalogEntry.findMany({
    where: {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { id: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
      ],
    },
    orderBy: [{ installs: "desc" }, { id: "asc" }],
    take: SEARCH_LIMIT,
    select: CATALOG_SELECT,
  });
  if (q.length < 2 || local.length >= LIVE_SEARCH_BELOW)
    return rankSkillMatches(local, q);
  const live = await searchSkillsSh(q).catch(() => []);
  const known = new Set(local.map((item) => item.id));
  return rankSkillMatches(
    [
      ...local,
      ...live
        .filter((item) => !known.has(item.id))
        .map((item) => ({ ...item, description: null })),
    ],
    q,
  ).slice(0, SEARCH_LIMIT);
}

/** Where skills usually live; tried before reading the repository tree. */
function likelySkillPaths(skillName: string): string[] {
  return [
    `skills/${skillName}/SKILL.md`,
    `${skillName}/SKILL.md`,
    `.claude/skills/${skillName}/SKILL.md`,
    `.agents/skills/${skillName}/SKILL.md`,
    "SKILL.md",
  ];
}

async function fetchSkillMarkdown(
  owner: string,
  repo: string,
  skillName: string,
): Promise<string> {
  for (const path of likelySkillPaths(skillName)) {
    const markdown = await rawFile(owner, repo, "HEAD", path).catch(() => null);
    if (!markdown) continue;
    const name = parseSkillFrontmatter(markdown).name;
    // A repository-root SKILL.md belongs to whichever skill it names.
    if (path === "SKILL.md" && name?.toLowerCase() !== skillName.toLowerCase())
      continue;
    return markdown;
  }
  const { ref, candidates } = await discoverSkills({
    owner,
    repo,
    ref: null,
    path: null,
    skillName,
  });
  const wanted = skillName.toLowerCase();
  const chosen = candidates.find(
    (c) =>
      c.name.toLowerCase() === wanted ||
      (c.path.split("/").at(-2) ?? "").toLowerCase() === wanted,
  );
  if (!chosen) throw new SokoBotSkillError(`Skill "${skillName}" not found`);
  return rawFile(owner, repo, ref, chosen.path);
}

function capContent(markdown: string): string {
  if (markdown.length <= MAX_SKILL_CONTENT_CHARS) return markdown;
  return `${markdown.slice(0, MAX_SKILL_CONTENT_CHARS)}\n\n[Skill truncated at ${MAX_SKILL_CONTENT_CHARS} characters]`;
}

/** One skill's SKILL.md and display fields, from the catalog cache or GitHub. */
export async function resolveSkill(id: string): Promise<ResolvedSkill> {
  const source = parseSkillSource(id);
  if (!source.skillName)
    throw new SokoBotSkillError("Use a skill id like owner/repo/skill");
  const skillId = `${source.owner}/${source.repo}/${source.skillName}`;
  const cached = await prisma.skillCatalogEntry.findUnique({
    where: { id: skillId },
    select: {
      name: true,
      description: true,
      markdown: true,
      markdownFetchedAt: true,
    },
  });
  const fresh =
    cached?.markdown &&
    cached.markdownFetchedAt &&
    Date.now() - cached.markdownFetchedAt.getTime() < MARKDOWN_TTL_MS;
  const markdown = fresh
    ? (cached.markdown as string)
    : await fetchSkillMarkdown(source.owner, source.repo, source.skillName);
  if (cached && !fresh) {
    await prisma.skillCatalogEntry.update({
      where: { id: skillId },
      data: { markdown, markdownFetchedAt: new Date() },
    });
  }
  const meta = parseSkillFrontmatter(markdown);
  return {
    id: skillId,
    name: cached?.name ?? meta.name ?? source.skillName,
    description: cached?.description ?? meta.description,
    url: `https://skills.sh/${skillId}`,
    content: capContent(markdown),
  };
}

/** The skills a sender attached, validated and resolved in the order given. */
export async function resolveMessageSkills(
  skillIds: readonly string[],
): Promise<ResolvedSkill[]> {
  const unique = [...new Set(skillIds.map((id) => id.trim()))];
  if (unique.length > MAX_SKILLS_PER_MESSAGE)
    throw new SokoBotSkillError(
      `Attach at most ${MAX_SKILLS_PER_MESSAGE} skills to a message`,
    );
  return Promise.all(unique.map((id) => resolveSkill(id)));
}
