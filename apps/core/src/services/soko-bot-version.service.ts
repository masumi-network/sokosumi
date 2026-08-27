import type { Prisma } from "@sokosumi/database";
import {
  DEFAULT_SOKO_BOT_VERSION_ID,
  getSokoBotVersion,
  isSokoBotCapability,
  SOKO_BOT_SKILLS,
  SOKO_BOT_VERSIONS,
  type SokoBotCapability,
  type SokoBotVersion,
} from "@sokosumi/soko-bot";

import { conflict, notFound, unprocessableEntity } from "@/helpers/error";
import prisma from "@/lib/db/prisma";

/**
 * Versions come from two places and share one id namespace.
 *
 * The built-ins in `packages/soko-bot/src/versions` stay immutable: they are
 * the known-good baseline, they are reviewable in git, and their lab history
 * stays comparable. Authored versions live in the database so an admin can
 * write a prompt, pick a model, choose skills and tools, try it in the lab,
 * and promote it — without a deploy.
 *
 * A bot's `versionId` resolves against either, authored first.
 */

export interface AuthoredVersionInput {
  slug: string;
  name: string;
  summary?: string;
  model: string;
  inferenceRegion?: "eu" | "us" | null;
  systemPrompt: string;
  skills: readonly string[];
  /** Empty means every capability the route allows. */
  capabilities: readonly string[];
}

type AuthoredRow = Prisma.SokoBotAuthoredVersionGetPayload<object>;

/** Authored rows are shaped into the same contract the runtime already reads. */
function toVersion(row: AuthoredRow): SokoBotVersion {
  const capabilities = row.capabilities.filter(isSokoBotCapability);
  return {
    id: row.slug,
    name: row.name,
    createdAt: row.createdAt.toISOString().slice(0, 10),
    summary: row.summary,
    model: row.model,
    systemPrompt: row.systemPrompt,
    skills: row.skills,
    ...(capabilities.length > 0
      ? { capabilities: capabilities as SokoBotCapability[] }
      : {}),
    ...(row.inferenceRegion === "eu" || row.inferenceRegion === "us"
      ? { inferenceRegion: row.inferenceRegion }
      : {}),
  };
}

function isBuiltInId(slug: string): boolean {
  return SOKO_BOT_VERSIONS.some((version) => version.id === slug);
}

/**
 * The version a turn should run. Falls back to the default exactly as
 * {@link getSokoBotVersion} does, so an id that no longer exists never leaves a
 * turn without a definition.
 */
export async function resolveSokoBotVersion(
  versionId: string | null | undefined,
): Promise<SokoBotVersion> {
  if (versionId && !isBuiltInId(versionId)) {
    const row = await prisma.sokoBotAuthoredVersion.findFirst({
      where: { slug: versionId, archivedAt: null },
    });
    if (row) return toVersion(row);
    // Pinned to something archived: fall back to whatever is promoted now,
    // not the hard-coded code default, or the bot silently regresses past it.
    const promoted = await getDefaultSokoBotVersionId();
    if (promoted !== versionId && !isBuiltInId(promoted)) {
      const fallback = await prisma.sokoBotAuthoredVersion.findFirst({
        where: { slug: promoted, archivedAt: null },
      });
      if (fallback) return toVersion(fallback);
    }
    return getSokoBotVersion(promoted);
  }
  return getSokoBotVersion(versionId);
}

/** Built-ins first, then authored, for pickers and the lab. */
export async function listSokoBotVersions(): Promise<
  (SokoBotVersion & { authored: boolean })[]
> {
  const rows = await prisma.sokoBotAuthoredVersion.findMany({
    where: { archivedAt: null },
    orderBy: { updatedAt: "desc" },
  });
  return [
    ...SOKO_BOT_VERSIONS.map((version) => ({ ...version, authored: false })),
    ...rows.map((row) => ({ ...toVersion(row), authored: true })),
  ];
}

/**
 * What a non-admin may see and run: the built-ins, the promoted default, and
 * whatever their own bots are already pinned to. Other authored versions are
 * console drafts — their composed system prompt is internal, and pinning a bot
 * to one would bypass promotion.
 */
export async function listSelectableSokoBotVersions(
  userId: string,
): Promise<(SokoBotVersion & { authored: boolean })[]> {
  const [all, defaultId, pinned] = await Promise.all([
    listSokoBotVersions(),
    getDefaultSokoBotVersionId(),
    ownPinnedVersionIds(userId),
  ]);
  return all.filter(
    (version) =>
      !version.authored || version.id === defaultId || pinned.has(version.id),
  );
}

export async function isSelectableSokoBotVersionId(
  slug: string,
  userId: string,
): Promise<boolean> {
  if (isBuiltInId(slug)) return true;
  if (slug === (await getDefaultSokoBotVersionId())) return true;
  return (await ownPinnedVersionIds(userId)).has(slug);
}

/** Versions this user's own live bots already run; never a leak back to them. */
async function ownPinnedVersionIds(userId: string): Promise<Set<string>> {
  const bots = await prisma.sokoBot.findMany({
    where: { userId, archivedAt: null },
    select: { versionId: true },
  });
  return new Set(bots.flatMap((bot) => (bot.versionId ? [bot.versionId] : [])));
}

export async function isKnownSokoBotVersionId(slug: string): Promise<boolean> {
  if (isBuiltInId(slug)) return true;
  const row = await prisma.sokoBotAuthoredVersion.findFirst({
    where: { slug, archivedAt: null },
    select: { id: true },
  });
  return row !== null;
}

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,40}$/;

function assertValid(input: AuthoredVersionInput): void {
  if (!SLUG_PATTERN.test(input.slug)) {
    throw unprocessableEntity(
      "Version id must be lowercase letters, numbers and dashes",
    );
  }
  if (!input.systemPrompt.trim()) {
    throw unprocessableEntity("System prompt is required");
  }
  if (!input.model.trim()) {
    throw unprocessableEntity("Model is required");
  }
  const unknown = input.capabilities.filter(
    (capability) => !isSokoBotCapability(capability),
  );
  if (unknown.length > 0) {
    throw unprocessableEntity(`Unknown tools: ${unknown.join(", ")}`);
  }
  // composeSystemPrompt throws on an unknown skill id, which would fail every
  // turn of this version at run time. Reject it while the author is watching.
  const unknownSkills = input.skills.filter(
    (id) => !SOKO_BOT_SKILLS.some((skill) => skill.id === id),
  );
  if (unknownSkills.length > 0) {
    throw unprocessableEntity(`Unknown skills: ${unknownSkills.join(", ")}`);
  }
}

export async function createAuthoredVersion(
  input: AuthoredVersionInput,
  createdById: string,
): Promise<SokoBotVersion> {
  assertValid(input);
  // Built-ins own their ids; shadowing one would silently change what a bot
  // pinned to it runs, and make lab history incomparable.
  if (isBuiltInId(input.slug)) {
    throw conflict(`"${input.slug}" is a built-in version id`);
  }
  const existing = await prisma.sokoBotAuthoredVersion.findUnique({
    where: { slug: input.slug },
    select: { id: true },
  });
  if (existing) throw conflict(`Version "${input.slug}" already exists`);

  const row = await prisma.sokoBotAuthoredVersion.create({
    data: {
      slug: input.slug,
      name: input.name,
      summary: input.summary ?? "",
      model: input.model,
      inferenceRegion: input.inferenceRegion ?? null,
      systemPrompt: input.systemPrompt,
      skills: [...input.skills],
      capabilities: [...input.capabilities],
      createdById,
    },
  });
  return toVersion(row);
}

export async function updateAuthoredVersion(
  slug: string,
  input: Omit<AuthoredVersionInput, "slug">,
): Promise<SokoBotVersion> {
  assertValid({ ...input, slug });
  const row = await prisma.sokoBotAuthoredVersion.findFirst({
    where: { slug, archivedAt: null },
    select: { id: true },
  });
  if (!row) throw notFound("Version not found");
  const updated = await prisma.sokoBotAuthoredVersion.update({
    where: { id: row.id },
    data: {
      name: input.name,
      summary: input.summary ?? "",
      model: input.model,
      inferenceRegion: input.inferenceRegion ?? null,
      systemPrompt: input.systemPrompt,
      skills: [...input.skills],
      capabilities: [...input.capabilities],
    },
  });
  return toVersion(updated);
}

export async function archiveAuthoredVersion(slug: string): Promise<void> {
  const [row, setting] = await Promise.all([
    prisma.sokoBotAuthoredVersion.findFirst({
      where: { slug, archivedAt: null },
      select: { id: true },
    }),
    prisma.sokoBotSetting.findUnique({
      where: { id: "singleton" },
      select: { defaultVersionId: true },
    }),
  ]);
  if (!row) throw notFound("Version not found");
  if (setting?.defaultVersionId === slug) {
    throw conflict("Promote another version before archiving this default");
  }
  const fallbackVersionId = await getDefaultSokoBotVersionId();
  await prisma.$transaction([
    prisma.sokoBotAuthoredVersion.update({
      where: { id: row.id },
      data: { archivedAt: new Date() },
    }),
    // Repoint pinned bots explicitly. Resolution would otherwise miss the
    // archived row and fall back on its own, silently changing the prompt and
    // model of a bot whose stored versionId still names the archived version.
    prisma.sokoBot.updateMany({
      where: { versionId: slug },
      data: { versionId: fallbackVersionId },
    }),
  ]);
}

/**
 * Version new bots are created on. Promoting affects new bots only — existing
 * bots keep the version they were pinned to at creation.
 */
export async function getDefaultSokoBotVersionId(): Promise<string> {
  const setting = await prisma.sokoBotSetting.findUnique({
    where: { id: "singleton" },
    select: { defaultVersionId: true },
  });
  const promoted = setting?.defaultVersionId;
  if (promoted && (await isKnownSokoBotVersionId(promoted))) return promoted;
  return DEFAULT_SOKO_BOT_VERSION_ID;
}

export async function promoteSokoBotVersion(slug: string): Promise<void> {
  if (!(await isKnownSokoBotVersionId(slug))) {
    throw notFound("Version not found");
  }
  await prisma.sokoBotSetting.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", defaultVersionId: slug },
    update: { defaultVersionId: slug },
  });
}
