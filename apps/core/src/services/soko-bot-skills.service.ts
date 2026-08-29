import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";

const GITHUB_API = "https://api.github.com";
const GITHUB_RAW = "https://raw.githubusercontent.com";
const SKILLS_SH = "https://skills.sh";
const MAX_CANDIDATES = 40;
const MAX_MARKDOWN_BYTES = 64 * 1024;
const MAX_INSTALLED_PER_BOT = 25;
const FETCH_TIMEOUT_MS = 15_000;

/** Skill containers the skills CLI scans, minus per-agent noise we do not need. */
const SKILL_CONTAINERS = [
  "skills",
  ".agents/skills",
  ".claude/skills",
  ".cursor/skills",
  ".codex/skills",
  ".github/skills",
];

export class SokoBotSkillError extends Error {}

export interface SkillCandidate {
  name: string;
  description: string;
  path: string;
}

export interface ParsedSkillSource {
  owner: string;
  repo: string;
  ref: string | null;
  /** Directory inside the repo when the URL pointed at one skill. */
  path: string | null;
  /** Skill name from an `owner/repo/skill` or skills.sh id. */
  skillName: string | null;
}

const SEGMENT = /^[A-Za-z0-9_.-]+$/;

/**
 * Accepts what people paste: `owner/repo`, `owner/repo/skill-name`,
 * `https://skills.sh/owner/repo/skill-name`, or a GitHub URL, optionally
 * with `/tree/<ref>/<path>` pointing at one skill directory.
 */
export function parseSkillSource(raw: string): ParsedSkillSource {
  const input = raw.trim().replace(/\/+$/, "");
  if (!input) throw new SokoBotSkillError("Enter a skill source");
  let segments: string[];
  let ref: string | null = null;
  let path: string | null = null;
  if (/^https?:\/\//i.test(input)) {
    const url = new URL(input);
    const parts = url.pathname.split("/").filter(Boolean);
    if (url.hostname === "skills.sh" || url.hostname === "www.skills.sh") {
      segments = parts;
    } else if (
      url.hostname === "github.com" ||
      url.hostname === "www.github.com"
    ) {
      if (parts.length >= 4 && (parts[2] === "tree" || parts[2] === "blob")) {
        ref = parts[3] ?? null;
        const rest = parts.slice(4).filter((p) => p !== "SKILL.md");
        path = rest.length ? rest.join("/") : null;
        segments = parts.slice(0, 2);
      } else {
        segments = parts.slice(0, 3);
      }
    } else {
      throw new SokoBotSkillError(
        "Only skills.sh and GitHub sources are supported",
      );
    }
  } else {
    segments = input.split("/").filter(Boolean);
  }
  const [owner, repoRaw, skillName] = segments;
  const repo = repoRaw?.replace(/\.git$/, "");
  if (!owner || !repo || !SEGMENT.test(owner) || !SEGMENT.test(repo)) {
    throw new SokoBotSkillError(
      "Use owner/repo, owner/repo/skill, or a skills.sh / GitHub URL",
    );
  }
  if (skillName && !SEGMENT.test(skillName)) {
    throw new SokoBotSkillError("Invalid skill name");
  }
  return { owner, repo, ref, path, skillName: skillName ?? null };
}

async function githubJson<T>(url: string): Promise<T> {
  const token = getEnv().GITHUB_TOKEN;
  const response = await fetch(url, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "sokosumi-soko-bot",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (response.status === 404)
    throw new SokoBotSkillError("Repository not found");
  if (response.status === 403 || response.status === 429) {
    throw new SokoBotSkillError(
      "GitHub rate limit reached; try again in a minute",
    );
  }
  if (!response.ok)
    throw new SokoBotSkillError(`GitHub responded ${response.status}`);
  return (await response.json()) as T;
}

async function rawFile(owner: string, repo: string, ref: string, path: string) {
  const response = await fetch(
    `${GITHUB_RAW}/${owner}/${repo}/${ref}/${path}`,
    {
      headers: { "user-agent": "sokosumi-soko-bot" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    },
  );
  if (!response.ok) throw new SokoBotSkillError(`Could not read ${path}`);
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_MARKDOWN_BYTES) {
    throw new SokoBotSkillError("SKILL.md is larger than 64 KB");
  }
  return text;
}

/** Minimal frontmatter reader: `name`, `description` (single line or folded). */
export function parseSkillFrontmatter(markdown: string): {
  name: string | null;
  description: string | null;
  body: string;
} {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { name: null, description: null, body: markdown };
  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (!kv) continue;
    fields[kv[1].toLowerCase()] = kv[2].replace(/^["']|["']$/g, "").trim();
  }
  return {
    name: fields.name ?? null,
    description: fields.description ?? null,
    body: markdown.slice(match[0].length),
  };
}

function inContainer(path: string): boolean {
  if (path === "SKILL.md") return true;
  return SKILL_CONTAINERS.some((container) => {
    if (!path.startsWith(`${container}/`)) return false;
    const depth = path.slice(container.length + 1).split("/").length - 1;
    return depth >= 1 && depth <= 3;
  });
}

async function resolveRef(source: ParsedSkillSource): Promise<string> {
  if (source.ref) return source.ref;
  const repo = await githubJson<{ default_branch: string }>(
    `${GITHUB_API}/repos/${source.owner}/${source.repo}`,
  );
  return repo.default_branch;
}

/** All skills a source offers, with their frontmatter, newest tree first. */
export async function discoverSkills(
  source: ParsedSkillSource,
): Promise<{ ref: string; candidates: SkillCandidate[] }> {
  const ref = await resolveRef(source);
  const tree = await githubJson<{ tree: { path: string; type: string }[] }>(
    `${GITHUB_API}/repos/${source.owner}/${source.repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
  );
  let paths = tree.tree
    .filter((entry) => entry.type === "blob" && entry.path.endsWith("SKILL.md"))
    .map((entry) => entry.path);
  if (source.path) {
    const wanted = `${source.path.replace(/\/$/, "")}/SKILL.md`;
    paths = paths.filter((p) => p === wanted);
  } else {
    paths = paths.filter(inContainer);
  }
  if (paths.length === 0)
    throw new SokoBotSkillError("No SKILL.md found in that repository");
  const candidates: SkillCandidate[] = [];
  for (const path of paths.slice(0, MAX_CANDIDATES)) {
    const markdown = await rawFile(source.owner, source.repo, ref, path);
    const meta = parseSkillFrontmatter(markdown);
    const dirName = path.split("/").at(-2) ?? source.repo;
    candidates.push({
      name: meta.name ?? dirName,
      description: meta.description ?? "",
      path,
    });
  }
  return { ref, candidates };
}

async function requireBot(userId: string, workspaceId: string) {
  const bot = await prisma.sokoBot.findFirst({
    where: { userId, workspaceId, archivedAt: null },
    select: { id: true },
  });
  if (!bot) throw new SokoBotSkillError("Create a Soko Bot first");
  return bot;
}

export async function listInstalledSkills(userId: string, workspaceId: string) {
  return prisma.sokoBotInstalledSkill.findMany({
    where: { userId, sokoBot: { workspaceId } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      sourceUrl: true,
      sourceRef: true,
      createdAt: true,
    },
  });
}

/**
 * Installs one skill. With several candidates and no skill name, returns
 * them instead so the owner can pick; the request is repeated with `skillName`.
 */
export async function installSkill(input: {
  userId: string;
  workspaceId: string;
  source: string;
  skillName?: string | null;
}) {
  const bot = await requireBot(input.userId, input.workspaceId);
  const parsed = parseSkillSource(input.source);
  const wanted = (input.skillName ?? parsed.skillName)?.toLowerCase() ?? null;
  const { ref, candidates } = await discoverSkills(parsed);
  const chosen = wanted
    ? candidates.find(
        (c) =>
          c.name.toLowerCase() === wanted ||
          (c.path.split("/").at(-2) ?? "").toLowerCase() === wanted,
      )
    : candidates.length === 1
      ? candidates[0]
      : null;
  if (!chosen) {
    if (wanted)
      throw new SokoBotSkillError(
        `No skill named "${wanted}" in that repository`,
      );
    return { skill: null, candidates };
  }
  const count = await prisma.sokoBotInstalledSkill.count({
    where: { sokoBotId: bot.id },
  });
  const existing = await prisma.sokoBotInstalledSkill.findUnique({
    where: { sokoBotId_name: { sokoBotId: bot.id, name: chosen.name } },
    select: { id: true },
  });
  if (!existing && count >= MAX_INSTALLED_PER_BOT) {
    throw new SokoBotSkillError(
      `At most ${MAX_INSTALLED_PER_BOT} installed skills per assistant`,
    );
  }
  const markdown = await rawFile(parsed.owner, parsed.repo, ref, chosen.path);
  const meta = parseSkillFrontmatter(markdown);
  const dir = chosen.path.replace(/\/?SKILL\.md$/, "");
  const data = {
    sokoBotId: bot.id,
    userId: input.userId,
    slug: `${parsed.owner}/${parsed.repo}/${chosen.name}`,
    name: chosen.name,
    description: meta.description ?? chosen.description,
    markdown,
    sourceUrl: `https://github.com/${parsed.owner}/${parsed.repo}/tree/${ref}/${dir}`,
    sourceRef: ref,
  };
  const skill = await prisma.sokoBotInstalledSkill.upsert({
    where: { sokoBotId_name: { sokoBotId: bot.id, name: chosen.name } },
    create: data,
    update: data,
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      sourceUrl: true,
      sourceRef: true,
      createdAt: true,
    },
  });
  return { skill, candidates: [] as SkillCandidate[] };
}

export async function removeInstalledSkill(userId: string, skillId: string) {
  const deleted = await prisma.sokoBotInstalledSkill.deleteMany({
    where: { id: skillId, userId },
  });
  if (deleted.count === 0) throw new SokoBotSkillError("Skill not found");
}

const BROWSE_PAGE_SIZE = 20;
const BROWSE_CACHE_MS = 60 * 60 * 1_000;
const RESERVED_FIRST_SEGMENTS = new Set([
  "site",
  "agent",
  "topic",
  "packs",
  "docs",
  "audits",
  "official",
  "hot",
  "trending",
  "api",
  "b",
]);
let browseCache: {
  at: number;
  items: { id: string; name: string; source: string; rank: number }[];
} | null = null;

/**
 * The skills.sh leaderboard (all-time, GitHub-hosted skills only), scraped
 * from the homepage's ordered skill links and cached for an hour. Enough to
 * browse the popular ones; search covers the rest.
 */
export async function browseSkillsSh(page: number) {
  if (!browseCache || Date.now() - browseCache.at > BROWSE_CACHE_MS) {
    const response = await fetch("https://www.skills.sh/", {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; sokosumi-soko-bot)",
        accept: "text/html",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new SokoBotSkillError("skills.sh is unavailable");
    const html = await response.text();
    const seen = new Set<string>();
    const items: { id: string; name: string; source: string; rank: number }[] =
      [];
    for (const match of html.matchAll(
      /href="\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)"/g,
    )) {
      const [, owner, repo, name] = match;
      if (RESERVED_FIRST_SEGMENTS.has(owner)) continue;
      const id = `${owner}/${repo}/${name}`;
      if (seen.has(id)) continue;
      seen.add(id);
      items.push({
        id,
        name,
        source: `${owner}/${repo}`,
        rank: items.length + 1,
      });
    }
    if (items.length === 0)
      throw new SokoBotSkillError("Could not read the skills.sh leaderboard");
    browseCache = { at: Date.now(), items };
  }
  const start = Math.max(0, page) * BROWSE_PAGE_SIZE;
  return {
    page,
    pageSize: BROWSE_PAGE_SIZE,
    total: browseCache.items.length,
    items: browseCache.items.slice(start, start + BROWSE_PAGE_SIZE),
  };
}

/** skills.sh search, proxied so the browser never talks to it directly. */
export async function searchSkillsSh(query: string) {
  const url = new URL("/api/search", SKILLS_SH);
  url.searchParams.set("q", query.slice(0, 100));
  url.searchParams.set("limit", "10");
  const response = await fetch(url, {
    headers: { "user-agent": "sokosumi-soko-bot" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok)
    throw new SokoBotSkillError("skills.sh search is unavailable");
  const body = (await response.json()) as {
    skills?: { id: string; name: string; source: string; installs?: number }[];
  };
  return (body.skills ?? []).map((skill) => ({
    id: skill.id,
    name: skill.name,
    source: skill.source,
    installs: skill.installs ?? 0,
  }));
}
