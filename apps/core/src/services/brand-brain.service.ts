import type {
  BrandBrain as BrandBrainRecord,
  Prisma,
} from "@sokosumi/database";
import {
  type BrandBrain,
  brandBrainSchema,
  CMO_BRAND_SECTION_KEYS,
  type CmoBrandAnswer,
  type CmoBrandFinding,
  type CmoBrandProfile,
  type CmoBrandQuestion,
  type CmoBrandSectionKey,
  type CmoSaveBrandBrainInput,
  cmoBrandProfileSchema,
  cmoSaveBrandBrainInputSchema,
} from "@sokosumi/soko-bot";
import { conflict, notFound, unprocessableEntity } from "@/helpers/error";
import { keepAnswers } from "@/helpers/question-answers";
import prisma from "@/lib/db/prisma";
import type { StudioBrandCopy } from "@/schemas/studio-brand-kit.schema";

/**
 * The Project's Brand Brain (ADR 0062): one per Project, read by every bot in
 * it, edited and confirmed by any member of its Workspace. Callers check that
 * membership; nothing here is CMO's.
 */

export function parseBrandBrain(value: unknown): BrandBrain | null {
  const parsed = brandBrainSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const BRAND_BRAIN_SELECT = {
  id: true,
  body: true,
  updatedAt: true,
  confirmedAt: true,
  confirmedBy: { select: { id: true, name: true } },
} as const satisfies Prisma.BrandBrainSelect;

export type StoredBrandBrain = Prisma.BrandBrainGetPayload<{
  select: typeof BRAND_BRAIN_SELECT;
}>;

export async function getBrandBrain(
  projectId: string,
  db: Prisma.TransactionClient = prisma,
): Promise<StoredBrandBrain | null> {
  return db.brandBrain.findUnique({
    where: { projectId },
    select: BRAND_BRAIN_SELECT,
  });
}

/**
 * Locks the Project's Brand Brain writes, existing row or not: section saves
 * run in parallel, and none may overwrite another.
 */
async function lockBrandBrain(tx: Prisma.TransactionClient, projectId: string) {
  await tx.$executeRaw`SELECT 1 FROM project WHERE id = ${projectId}::uuid FOR NO KEY UPDATE`;
  return await tx.brandBrain.findUnique({
    where: { projectId },
    select: { body: true, updatedAt: true },
  });
}

/**
 * Merges a save into the Project's Brand Brain: sent sections replace theirs,
 * sent essentials replace the essentials. Until the essentials exist the
 * record holds only sections and nobody sees it yet.
 */
export async function saveBrandBrain(
  projectId: string,
  input: CmoSaveBrandBrainInput,
  db?: Prisma.TransactionClient,
  /**
   * Cuso's save: when his turn was asked, so only the corrections in its
   * brief close. A member's own edit closes the fix whenever it was asked.
   */
  options: { briefedAt?: Date } = {},
): Promise<BrandBrainRecord> {
  const save = cmoSaveBrandBrainInputSchema.parse(input);
  const write = async (tx: Prisma.TransactionClient) => {
    const row = await lockBrandBrain(tx, projectId);
    const stored = storedBrandBrain(row?.body);
    const incoming = { ...save.brandBrain?.profile, ...save.sections };
    // Cuso's packet carries no findings; a section he rewrites keeps them.
    // The owner's fix is Core's: it stays, and closes once the answer changes.
    const kept = Object.fromEntries(
      Object.entries(incoming).map(([key, sent]) => {
        const before = stored.profile[key as CmoBrandSectionKey];
        if (!sent) return [key, sent];
        const { fix: _sent, ...section } = sent;
        // A correction asked while the turn wrote never reached it: it stays
        // open, so the next change picks it up.
        const briefed =
          !options.briefedAt ||
          (before?.fix &&
            Date.parse(before.fix.at) <= options.briefedAt.getTime());
        const fix = before?.fix && {
          ...before.fix,
          fixed:
            before.fix.fixed ||
            (section.answer !== before.answer && Boolean(briefed)),
        };
        return [
          key,
          {
            ...section,
            ...(section.findings.length === 0 && before
              ? { findings: before.findings }
              : {}),
            ...(fix ? { fix } : {}),
          },
        ];
      }),
    );
    const profile = cmoBrandProfileSchema.parse({
      ...stored.profile,
      ...kept,
    });
    const before = parseBrandBrain(stored);
    const { reveal, marketingToday } = save;
    const base = save.brandBrain ?? before;
    const patchingQuestions = save.questions !== undefined;
    if (!base && (reveal || marketingToday || patchingQuestions)) {
      throw unprocessableEntity(
        "Save the essentials in brandBrain first; reveal, marketingToday and questions add to them.",
      );
    }
    // Essentials saved again without questions keep the stored ones: an empty
    // list would wipe what was asked and answered, and they would be asked
    // again.
    const sent = save.questions ?? save.brandBrain?.questions ?? [];
    const questions = withCorrections(
      sent.length > 0
        ? keepAnswers(sent, before?.questions ?? [])
        : (before?.questions ?? []),
      before?.questions ?? [],
      rewrittenSections(stored.profile, profile),
    );
    const essentials = base
      ? {
          ...base,
          ...(reveal ? { reveal } : {}),
          ...(marketingToday ? { marketingToday } : {}),
          questions,
        }
      : null;
    const body = essentials ? { ...essentials, profile } : { profile };
    const updatedAt = essentials ? { updatedAt: new Date() } : {};
    return tx.brandBrain.upsert({
      where: { projectId },
      create: { projectId, body, ...updatedAt },
      update: { body, ...updatedAt },
    });
  };
  return db ? write(db) : prisma.$transaction(write);
}

export async function saveStudioBrandCopy(
  projectId: string,
  copy: StudioBrandCopy,
  version: string | null,
): Promise<string> {
  return await prisma.$transaction(async (tx) => {
    const row = await lockBrandBrain(tx, projectId);
    if ((row?.updatedAt?.toISOString() ?? null) !== version) {
      throw conflict("The brand kit changed. Reload it before saving.");
    }
    const existing = parseBrandBrain(row?.body);
    const body = brandBrainSchema.parse({
      products: [],
      competitors: [],
      channels: [],
      profile: storedBrandBrain(row?.body).profile,
      ...existing,
      summary: copy.summary,
      audience: copy.audience,
      voice: {
        do: existing?.voice.do ?? [],
        dont: existing?.voice.dont ?? [],
        tone: copy.tone,
        examples: copy.approvedLines,
      },
    });
    const updatedAt = new Date(
      Math.max(Date.now(), (row?.updatedAt?.getTime() ?? 0) + 1),
    );
    await tx.brandBrain.upsert({
      where: { projectId },
      create: { projectId, body, updatedAt },
      update: { body, updatedAt },
    });
    return updatedAt.toISOString();
  });
}

/** The sections whose answer a save changed. */
function rewrittenSections(
  before: CmoBrandProfile,
  after: CmoBrandProfile,
): Set<CmoBrandSectionKey> {
  return new Set(
    CMO_BRAND_SECTION_KEYS.filter(
      (key) => after[key] && after[key]?.answer !== before[key]?.answer,
    ),
  );
}

/**
 * A no waits for its section to be rewritten (by Cuso or a member); Core
 * alone keeps the flag, so whatever a save sends for it is ignored.
 */
function withCorrections(
  questions: CmoBrandQuestion[],
  stored: CmoBrandQuestion[],
  rewritten: ReadonlySet<CmoBrandSectionKey>,
): CmoBrandQuestion[] {
  return questions.map(({ corrected: _sent, ...question }) => {
    if (question.answer !== "no") return question;
    const waiting =
      stored.find((candidate) => candidate.id === question.id)?.corrected ===
      false;
    return {
      ...question,
      corrected: !waiting || rewritten.has(question.section),
    };
  });
}

/** A section's waiting correction, as the Brand Brain stores it. */
const BRAND_FIX_NOTE_MAX = 400;

/**
 * The owner says one section is wrong: the fix waits on that section until
 * Cuso (or a member) rewrites its answer. A second fix before then adds to
 * the first. The other sections are not touched.
 */
export async function requestBrandBrainFix(
  projectId: string,
  input: { section: CmoBrandSectionKey; note: string; at?: Date },
): Promise<BrandBrain> {
  return prisma.$transaction(async (tx) => {
    const brain = parseBrandBrain((await lockBrandBrain(tx, projectId))?.body);
    const section = brain?.profile[input.section];
    if (!brain || !section) {
      throw notFound("That section is not in the Brand Brain");
    }
    const open = section.fix && !section.fix.fixed ? section.fix.note : null;
    const note = open ? `${open} ${input.note}` : input.note;
    // Cut to fit, the newest correction would be lost while the owner reads
    // that it was taken.
    if (note.length > BRAND_FIX_NOTE_MAX)
      throw conflict(
        "This section already has a correction waiting for Cuso, and this one does not fit beside it. Wait until he has rewritten the section, or say it in fewer words.",
      );
    const fix = {
      note,
      at: (input.at ?? new Date()).toISOString(),
      fixed: false,
    };
    const fixed = {
      ...brain,
      profile: { ...brain.profile, [input.section]: { ...section, fix } },
    };
    await tx.brandBrain.update({ where: { projectId }, data: { body: fixed } });
    return fixed;
  });
}

/**
 * Takes one correction back out of a section's open fix, when the owner
 * changes the answer that asked for it. A fix left with nothing in it closes.
 */
export async function withdrawBrandBrainFix(
  projectId: string,
  input: { section: CmoBrandSectionKey; note: string },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const brain = parseBrandBrain((await lockBrandBrain(tx, projectId))?.body);
    const section = brain?.profile[input.section];
    const fix = section?.fix;
    if (
      !brain ||
      !section ||
      !fix ||
      fix.fixed ||
      !fix.note.includes(input.note)
    )
      return;
    const note = fix.note.replace(input.note, "").replace(/\s+/g, " ").trim();
    const withdrawn = {
      ...brain,
      profile: {
        ...brain.profile,
        [input.section]: {
          ...section,
          fix: note ? { ...fix, note } : { ...fix, fixed: true },
        },
      },
    };
    await tx.brandBrain.update({
      where: { projectId },
      data: { body: withdrawn },
    });
  });
}

/** The sections the owner fixed that Cuso has not rewritten yet. */
export function brandBrainOpenFixes(
  brain: BrandBrain,
): { section: CmoBrandSectionKey; note: string; at: string }[] {
  return CMO_BRAND_SECTION_KEYS.flatMap((key) => {
    const fix = brain.profile[key]?.fix;
    return fix && !fix.fixed
      ? [{ section: key, note: fix.note, at: fix.at }]
      : [];
  });
}

/** The answers whose sections still say what the owner said is not true. */
export function brandBrainCorrections(brain: BrandBrain): CmoBrandQuestion[] {
  return brain.questions.filter(
    (question) => question.answer === "no" && question.corrected === false,
  );
}

/**
 * What an answer adds to its section: a yes confirms the statement (with the
 * owner's details), a no records what is true instead or, without a note,
 * that the statement is not, and a not sure adds only the owner's details.
 */
function answerFinding(question: CmoBrandQuestion): CmoBrandFinding | null {
  const point =
    question.answer === "yes"
      ? confirmed(question.statement, question.note)
      : question.answer === "no"
        ? (question.note ?? notTrue(question.statement))
        : question.note;
  return point
    ? {
        point,
        evidence: "fact",
        confidence: "high",
        asOf: new Date().toISOString().slice(0, 7),
      }
    : null;
}

function notTrue(statement: string): string {
  return `Not true: ${statement}`.slice(0, 400);
}

function confirmed(statement: string, note: string | undefined): string {
  return note ? `${statement} (${note})`.slice(0, 400) : statement;
}

/**
 * A member checked the Brand Brain: records who and when, replacing an
 * earlier confirmation, so bots know a person read it.
 */
export async function confirmBrandBrain(
  projectId: string,
  userId: string,
): Promise<StoredBrandBrain> {
  const current = await getBrandBrain(projectId);
  if (!parseBrandBrain(current?.body)) {
    throw conflict("The Brand Brain is still being built");
  }
  return prisma.brandBrain.update({
    where: { projectId },
    data: { confirmedAt: new Date(), confirmedByUserId: userId },
    select: BRAND_BRAIN_SELECT,
  });
}

/**
 * A member's answer to one of the Brand Brain's yes/no questions. It is
 * stored on the question and lands in its section as a confirmed finding
 * (replacing what an earlier answer to the same question put there), so every
 * later plan and post reads it.
 */
export async function answerBrandBrainQuestion(
  projectId: string,
  input: { questionId: string; answer: CmoBrandAnswer; note?: string },
): Promise<CmoBrandQuestion> {
  return prisma.$transaction(async (tx) => {
    const brain = parseBrandBrain((await lockBrandBrain(tx, projectId))?.body);
    const question = brain?.questions.find(
      (candidate) => candidate.id === input.questionId,
    );
    if (!brain || !question) {
      throw notFound("That question is not in the Brand Brain");
    }
    const { corrected: _earlier, ...asked } = question;
    const answered: CmoBrandQuestion = {
      ...asked,
      answer: input.answer,
      // Any answer may carry the owner's details, not only a no.
      note: input.note?.trim() || undefined,
      // A no stays open until its section says what is true instead.
      ...(input.answer === "no" ? { corrected: false } : {}),
    };
    const earlier = [
      question.statement,
      notTrue(question.statement),
      question.note,
      confirmed(question.statement, question.note),
    ].filter(Boolean);
    const section = brain.profile[question.section];
    const finding = answerFinding(answered);
    const findings = [
      ...(finding ? [finding] : []),
      ...(section?.findings ?? []).filter(
        (candidate) => !earlier.includes(candidate.point),
      ),
    ].slice(0, 6);
    const profile = {
      ...brain.profile,
      [question.section]: section
        ? { ...section, findings }
        : finding
          ? { answer: finding.point, findings, openQuestions: [] }
          : undefined,
    };
    await tx.brandBrain.update({
      where: { projectId },
      data: {
        body: {
          ...brain,
          profile,
          questions: brain.questions.map((candidate) =>
            candidate.id === question.id ? answered : candidate,
          ),
        },
      },
    });
    return answered;
  });
}

/** A saved profile section at a glance. */
export interface CmoSectionHeadline {
  key: CmoBrandSectionKey;
  headline: string;
}

/**
 * The profile sections a stored Brand Brain holds, in profile order, each with
 * its headline (the answer when a section was saved without one).
 */
export function brandBrainSectionHeadlines(
  value: unknown,
): CmoSectionHeadline[] {
  const { profile } = storedBrandBrain(value);
  return CMO_BRAND_SECTION_KEYS.flatMap((key) => {
    const section = profile[key];
    return section
      ? [{ key, headline: section.headline || section.answer }]
      : [];
  });
}

/** The profile sections a stored Brand Brain holds, in profile order. */
export function brandBrainSectionsSaved(value: unknown): CmoBrandSectionKey[] {
  return brandBrainSectionHeadlines(value).map(({ key }) => key);
}

function storedBrandBrain(value: unknown): { profile: CmoBrandProfile } {
  const record =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const profile = cmoBrandProfileSchema.safeParse(record.profile ?? {});
  return { ...record, profile: profile.success ? profile.data : {} };
}

/**
 * The Brand Brain as a turn reads it: each section's headline, answer, what
 * its findings mean and its open questions. The findings themselves stay
 * stored; a full profile no longer fits a context packet.
 */
export function compactBrandBrain(
  brain: BrandBrain | null,
): Record<string, unknown> | null {
  if (!brain) return null;
  const profile = Object.fromEntries(
    Object.entries(brain.profile ?? {}).flatMap(([key, section]) =>
      section
        ? [
            [
              key,
              {
                headline: section.headline,
                answer: section.answer,
                soWhat: section.findings
                  .map((finding) => finding.implication)
                  .filter(Boolean)
                  .slice(0, 2),
                openQuestions: section.openQuestions,
                findingsStored: section.findings.length,
              },
            ],
          ]
        : [],
    ),
  );
  // An answered question already lives in its section as a finding.
  const questions = brain.questions.filter((question) => !question.answer);
  return { ...brain, profile, questions };
}
