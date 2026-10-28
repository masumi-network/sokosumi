import type { BrandBrain, Prisma } from "@sokosumi/database";
import {
  CMO_BRAND_SECTION_KEYS,
  type CmoBrandAnswer,
  type CmoBrandBrain,
  type CmoBrandFinding,
  type CmoBrandProfile,
  type CmoBrandQuestion,
  type CmoBrandSectionKey,
  type CmoSaveBrandBrainInput,
  cmoBrandBrainSchema,
  cmoBrandProfileSchema,
  cmoSaveBrandBrainInputSchema,
} from "@sokosumi/soko-bot";
import { conflict, notFound } from "@/helpers/error";
import prisma from "@/lib/db/prisma";

/**
 * The Project's Brand Brain (ADR 0062): one per Project, read by every bot in
 * it, edited and confirmed by any member of its Workspace. Callers check that
 * membership; nothing here is CMO's.
 */

export function parseBrandBrain(value: unknown): CmoBrandBrain | null {
  const parsed = cmoBrandBrainSchema.safeParse(value);
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
async function lockBrandBrain(
  tx: Prisma.TransactionClient,
  projectId: string,
): Promise<unknown> {
  await tx.$executeRaw`SELECT 1 FROM project WHERE id = ${projectId}::uuid FOR NO KEY UPDATE`;
  const row = await tx.brandBrain.findUnique({
    where: { projectId },
    select: { body: true },
  });
  return row?.body ?? null;
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
): Promise<BrandBrain> {
  const save = cmoSaveBrandBrainInputSchema.parse(input);
  const write = async (tx: Prisma.TransactionClient) => {
    const stored = storedBrandBrain(await lockBrandBrain(tx, projectId));
    const incoming = { ...save.brandBrain?.profile, ...save.sections };
    // Cuso's packet carries no findings; a section he rewrites keeps them.
    const kept = Object.fromEntries(
      Object.entries(incoming).map(([key, section]) => {
        const before = stored.profile[key as CmoBrandSectionKey];
        return [
          key,
          section && section.findings.length === 0 && before
            ? { ...section, findings: before.findings }
            : section,
        ];
      }),
    );
    const profile = cmoBrandProfileSchema.parse({
      ...stored.profile,
      ...kept,
    });
    const before = parseBrandBrain(stored);
    const essentials = save.brandBrain
      ? {
          ...save.brandBrain,
          questions: keepAnswers(
            save.brandBrain.questions,
            before?.questions ?? [],
          ),
        }
      : before;
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

/**
 * Questions saved again keep the members' answers: Cuso asks, only members
 * answer, so an answer Cuso leaves out is the stored one.
 */
function keepAnswers(
  incoming: CmoBrandQuestion[],
  stored: CmoBrandQuestion[],
): CmoBrandQuestion[] {
  return incoming.map((question) => {
    const answered = stored.find((candidate) => candidate.id === question.id);
    return answered?.answer && !question.answer
      ? { ...question, answer: answered.answer, note: answered.note }
      : question;
  });
}

/** What an answer adds to its section: a yes confirms, a no with a note corrects. */
function answerFinding(question: CmoBrandQuestion): CmoBrandFinding | null {
  const point =
    question.answer === "yes"
      ? question.statement
      : question.answer === "no"
        ? question.note
        : undefined;
  return point
    ? {
        point,
        evidence: "fact",
        confidence: "high",
        asOf: new Date().toISOString().slice(0, 7),
      }
    : null;
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
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const brain = parseBrandBrain(await lockBrandBrain(tx, projectId));
    const question = brain?.questions.find(
      (candidate) => candidate.id === input.questionId,
    );
    if (!brain || !question) {
      throw notFound("That question is not in the Brand Brain");
    }
    const answered: CmoBrandQuestion = {
      ...question,
      answer: input.answer,
      note: input.answer === "no" ? input.note?.trim() || undefined : undefined,
    };
    const earlier = [question.statement, question.note].filter(Boolean);
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
  });
}

/** The profile sections a stored Brand Brain holds, in profile order. */
export function brandBrainSectionsSaved(value: unknown): CmoBrandSectionKey[] {
  const { profile } = storedBrandBrain(value);
  return CMO_BRAND_SECTION_KEYS.filter((key) => profile[key]);
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
  brain: CmoBrandBrain | null,
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
