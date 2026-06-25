import { getVercelOidcToken } from "@vercel/oidc";

import { getEnv } from "@/config/env";

/**
 * Client for the skills.sh marketplace API (https://skills.sh/api/v1).
 *
 * Sokosumi owns browse/search/audit because it holds the Vercel OIDC token —
 * the Hermes orchestrator cannot reach skills.sh. Core fetches the audited
 * skill files here and hands them to the orchestrator (see
 * `hermes-orchestrator.client.ts`) which writes them onto the user's agent.
 *
 * Auth: `Authorization: Bearer ${VERCEL_OIDC_TOKEN}`. The token is injected by
 * the Vercel runtime. When it's absent (local/non-Vercel), the catalog is
 * unavailable and callers should degrade gracefully rather than 500.
 *
 * Rate limit: 600 req/min. Responses carry `Cache-Control`; we keep a small
 * in-process TTL cache for idempotent GETs so repeated browsing within a warm
 * instance doesn't burn the budget.
 */

export type SkillsRiskLevel = "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type SkillsAuditStatus = "pass" | "warn" | "fail";

export type SkillsLeaderboardView = "trending" | "hot" | "all-time";

export interface SkillsShCatalogItem {
  /** `${source}/${slug}`, e.g. "vercel-labs/skills/find-skills". */
  skillId: string;
  /** Repo the skill lives in, `owner/repo` (e.g. "vercel-labs/skills"). */
  source: string;
  slug: string;
  name: string;
  description: string | null;
  /** Popularity signal used to rank the catalog. Null when unranked. */
  installs: number | null;
  /** True for officially curated skills (`/skills/curated`). */
  curated: boolean;
}

export interface SkillsShFile {
  path: string;
  contents: string;
}

export interface SkillsShDetail extends SkillsShCatalogItem {
  /** sha256 of the skill contents, pinned through to the orchestrator. */
  hash: string | null;
  files: SkillsShFile[];
  installUrl: string | null;
}

export interface SkillsShAuditEntry {
  provider: string;
  status: SkillsAuditStatus;
  riskLevel: SkillsRiskLevel;
}

export interface SkillsShAudit {
  audits: SkillsShAuditEntry[];
}

/** Thrown when the OIDC token is missing — the catalog is unreachable. */
export class SkillsShUnavailableError extends Error {
  constructor() {
    super("skills.sh is unavailable (no Vercel OIDC token in this runtime)");
    this.name = "SkillsShUnavailableError";
  }
}

export class SkillsShError extends Error {
  readonly httpStatus: number;
  constructor(httpStatus: number, message: string) {
    super(message);
    this.name = "SkillsShError";
    this.httpStatus = httpStatus;
  }
}

const RISK_ORDER: SkillsRiskLevel[] = [
  "NONE",
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
];

/** Worst (highest) risk across all audit providers; null when unaudited. */
export function worstAuditRisk(audit: SkillsShAudit): SkillsRiskLevel | null {
  if (audit.audits.length === 0) return null;
  return audit.audits.reduce<SkillsRiskLevel>((worst, entry) => {
    return RISK_ORDER.indexOf(entry.riskLevel) > RISK_ORDER.indexOf(worst)
      ? entry.riskLevel
      : worst;
  }, "NONE");
}

// ── In-process TTL cache for GETs ────────────────────────────────────────────
const CACHE_TTL_MS = 60_000;
// Bound the tail — a slow/hung skills.sh call must not stall the marketplace
// load indefinitely (undici has no default timeout). Generous enough for the
// semantic search path; callers degrade to empty on abort.
const REQUEST_TIMEOUT_MS = 6000;
const cache = new Map<string, { expiresAt: number; value: unknown }>();

// The Vercel runtime exposes the OIDC token via `getVercelOidcToken()`, which
// resolves it from the request context and refreshes in dev — the bare
// `VERCEL_OIDC_TOKEN` env var is frequently absent in the function runtime even
// when OIDC is enabled, so prefer the helper and fall back to the env var.
async function resolveOidcToken(): Promise<string | null> {
  try {
    const token = await getVercelOidcToken();
    if (token) return token;
  } catch {
    // No runtime token (local/non-Vercel, or OIDC disabled) — try the env var.
  }
  return getEnv().VERCEL_OIDC_TOKEN ?? null;
}

async function skillsGet<T>(
  path: string,
  parse: (raw: unknown) => T,
): Promise<T> {
  const token = await resolveOidcToken();
  if (!token) throw new SkillsShUnavailableError();

  const url = `${getEnv().SKILLS_SH_BASE_URL}${path}`;
  const cached = cache.get(url);
  if (cached && cached.expiresAt > nowMs()) return cached.value as T;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new SkillsShError(res.status, `skills.sh ${path} -> ${res.status}`);
  }
  const raw = (await res.json().catch(() => ({}))) as unknown;
  const value = parse(raw);
  if (value !== null) {
    cache.set(url, { expiresAt: nowMs() + CACHE_TTL_MS, value });
  }
  return value;
}

// `Date.now()` is wrapped so the rest of the module reads clearly; tests can
// run against the real clock since the TTL is short.
function nowMs(): number {
  return Date.now();
}

// ── Defensive parsing (skills.sh is an external contract) ────────────────────
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseCatalogItem(
  raw: unknown,
  opts: { curated?: boolean } = {},
): SkillsShCatalogItem | null {
  const r = asRecord(raw);
  const source = str(r.source) ?? str(r.repo);
  const slug = str(r.slug) ?? str(r.name);
  if (!source || !slug) return null;
  return {
    skillId: str(r.skillId) ?? str(r.id) ?? `${source}/${slug}`,
    source,
    slug,
    name: str(r.name) ?? slug,
    description: str(r.description) ?? str(r.summary),
    installs: num(r.installs) ?? num(r.installCount) ?? num(r.downloads),
    curated: opts.curated ?? r.curated === true,
  };
}

function parseList(
  raw: unknown,
  opts: { curated?: boolean } = {},
): SkillsShCatalogItem[] {
  const r = asRecord(raw);
  const arr = Array.isArray(raw)
    ? raw
    : Array.isArray(r.skills)
      ? r.skills
      : Array.isArray(r.data)
        ? r.data
        : Array.isArray(r.results)
          ? r.results
          : [];
  return arr
    .map((item) => parseCatalogItem(item, opts))
    .filter((item): item is SkillsShCatalogItem => item !== null);
}

// `/skills/curated` is grouped by owner: `{ data: [{ owner, skills: [...] }] }`,
// not a flat list. Flatten each owner's nested `skills` array (and tolerate a
// flat list defensively, in case the shape changes).
function parseCuratedList(raw: unknown): SkillsShCatalogItem[] {
  const r = asRecord(raw);
  const groups = Array.isArray(raw)
    ? raw
    : Array.isArray(r.data)
      ? r.data
      : Array.isArray(r.skills)
        ? r.skills
        : [];
  const items: SkillsShCatalogItem[] = [];
  for (const group of groups) {
    const g = asRecord(group);
    const skills = Array.isArray(g.skills) ? g.skills : [group];
    for (const skill of skills) {
      const item = parseCatalogItem(skill, { curated: true });
      if (item) items.push(item);
    }
  }
  return items;
}

function parseFiles(raw: unknown): SkillsShFile[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((f) => {
      const r = asRecord(f);
      const path = str(r.path);
      const contents = typeof r.contents === "string" ? r.contents : null;
      return path && contents !== null ? { path, contents } : null;
    })
    .filter((f): f is SkillsShFile => f !== null);
}

// The detail endpoint omits `installUrl`; reconstruct it from `source`.
// GitHub sources are `owner/repo` (→ a github.com repo URL); well-known
// sources are bare domains (→ used directly with `npx skills add`).
function deriveInstallUrl(source: string): string {
  return source.includes("/")
    ? `https://github.com/${source}`
    : `https://${source}`;
}

function parseDetail(raw: unknown): SkillsShDetail | null {
  const r = asRecord(raw);
  const base = parseCatalogItem(r.skill ?? raw);
  if (!base) return null;
  return {
    ...base,
    hash: str(r.hash),
    files: parseFiles(r.files),
    installUrl:
      str(r.installUrl) ??
      str(r.repoUrl) ??
      str(r.url) ??
      deriveInstallUrl(base.source),
  };
}

function parseRisk(value: unknown): SkillsRiskLevel {
  return typeof value === "string" && (RISK_ORDER as string[]).includes(value)
    ? (value as SkillsRiskLevel)
    : "NONE";
}

function parseStatus(value: unknown): SkillsAuditStatus {
  return value === "pass" || value === "warn" || value === "fail"
    ? value
    : "warn";
}

function parseAudit(raw: unknown): SkillsShAudit {
  const r = asRecord(raw);
  const arr = Array.isArray(r.audits) ? r.audits : [];
  return {
    audits: arr.map((a) => {
      const ar = asRecord(a);
      return {
        provider: str(ar.provider) ?? "unknown",
        status: parseStatus(ar.status),
        riskLevel: parseRisk(ar.riskLevel),
      };
    }),
  };
}

// `source` (owner/repo) is encoded as two path segments; the slug is the third.
function skillPath(prefix: string, source: string, slug: string): string {
  const segments = `${source}/${slug}`
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");
  return `${prefix}/${segments}`;
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function browseSkills(args: {
  view?: SkillsLeaderboardView;
  page?: number;
  perPage?: number;
}): Promise<SkillsShCatalogItem[]> {
  const params = new URLSearchParams({ view: args.view ?? "trending" });
  if (args.page) params.set("page", String(args.page));
  if (args.perPage) params.set("per_page", String(args.perPage));
  return skillsGet(`/skills?${params.toString()}`, (raw) => parseList(raw));
}

export async function searchSkills(args: {
  q: string;
  limit?: number;
}): Promise<SkillsShCatalogItem[]> {
  const params = new URLSearchParams({ q: args.q });
  if (args.limit) params.set("limit", String(args.limit));
  return skillsGet(`/skills/search?${params.toString()}`, (raw) =>
    parseList(raw),
  );
}

export async function getCuratedSkills(): Promise<SkillsShCatalogItem[]> {
  return skillsGet(`/skills/curated`, (raw) => parseCuratedList(raw));
}

export async function getSkillDetail(
  source: string,
  slug: string,
): Promise<SkillsShDetail | null> {
  try {
    return await skillsGet(skillPath("/skills", source, slug), (raw) =>
      parseDetail(raw),
    );
  } catch (error) {
    if (error instanceof SkillsShError && error.httpStatus === 404) {
      return null;
    }
    throw error;
  }
}

export async function getSkillAudit(
  source: string,
  slug: string,
): Promise<SkillsShAudit> {
  try {
    return await skillsGet(skillPath("/skills/audit", source, slug), (raw) =>
      parseAudit(raw),
    );
  } catch (error) {
    // skills.sh returns 404 until a partner has audited the skill (audits are
    // generated minutes after the first install). Treat "not yet audited" as
    // no audits — the install gate then prompts the user to confirm.
    if (error instanceof SkillsShError && error.httpStatus === 404) {
      return { audits: [] };
    }
    throw error;
  }
}
