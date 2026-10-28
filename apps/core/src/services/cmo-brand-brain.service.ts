import { type CmoHire, type Prisma } from "@sokosumi/database";
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
import prisma from "@/lib/db/prisma";
import {
  CmoConflictError,
  CmoNotFoundError,
  cmoHireWhere,
  getCmoHireForUser,
} from "@/services/cmo-cuso.service";

export function parseCmoBrandBrain(value: unknown): CmoBrandBrain | null {
  const parsed = cmoBrandBrainSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Merges a save into the stored Brand Brain: sent sections replace theirs,
 * sent essentials replace the essentials. Until the essentials exist the
 * record holds only sections and the owner does not see it yet.
 */
export async function saveCmoBrandBrain(
  where: { userId: string } | { sokoBotId: string },
  input: CmoSaveBrandBrainInput,
  db?: Prisma.TransactionClient,
): Promise<CmoHire> {
  const save = cmoSaveBrandBrainInputSchema.parse(input);
  const target = await cmoHireWhere(where);
  const write = async (tx: Prisma.TransactionClient) => {
    const hire = await tx.cmoHire.findUnique({
      where: target,
      select: { id: true },
    });
    if (!hire) throw new CmoNotFoundError("Cuso is not hired yet");
    // Section saves run in parallel: lock the row so none overwrites another.
    await tx.$executeRaw`SELECT 1 FROM cmo_hire WHERE id = ${hire.id}::uuid FOR UPDATE`;
    const current = await tx.cmoHire.findUnique({
      where: { id: hire.id },
      select: { brandBrain: true },
    });
    const stored = storedBrandBrain(current?.brandBrain);
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
    const before = parseCmoBrandBrain(stored);
    const essentials = save.brandBrain
      ? {
          ...save.brandBrain,
          questions: keepAnswers(
            save.brandBrain.questions,
            before?.questions ?? [],
          ),
        }
      : before;
    const next = essentials ? { ...essentials, profile } : { profile };
    return tx.cmoHire.update({
      where: { id: hire.id },
      data: {
        brandBrain: next,
        ...(essentials ? { brandBrainUpdatedAt: new Date() } : {}),
      },
    });
  };
  return db ? write(db) : prisma.$transaction(write);
}

/**
 * Questions saved again keep the owner's answers: Cuso asks, only the owner
 * answers, so an answer Cuso leaves out is the stored one.
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

/** The owner approved the Brand Brain; his questions come next. */
export async function approveCmoBrandBrain(userId: string): Promise<void> {
  const hire = await getCmoHireForUser(userId);
  if (!hire) throw new CmoNotFoundError("Cuso is not hired yet");
  if (!parseCmoBrandBrain(hire.brandBrain)) {
    throw new CmoConflictError("Cuso is still building the Brand Brain");
  }
  if (hire.brandBrainApprovedAt) return;
  await prisma.cmoHire.update({
    where: { id: hire.id },
    data: { brandBrainApprovedAt: new Date() },
  });
}

/**
 * The owner's answer to one of Cuso's questions. It is stored on the
 * question and lands in its section as a confirmed finding (replacing what
 * an earlier answer to the same question put there), so every later plan and
 * post reads it.
 */
export async function answerCmoBrandQuestion(
  userId: string,
  input: { questionId: string; answer: CmoBrandAnswer; note?: string },
): Promise<void> {
  const target = await cmoHireWhere({ userId });
  await prisma.$transaction(async (tx) => {
    const hire = await tx.cmoHire.findUnique({
      where: target,
      select: { id: true },
    });
    if (!hire) throw new CmoNotFoundError("Cuso is not hired yet");
    await tx.$executeRaw`SELECT 1 FROM cmo_hire WHERE id = ${hire.id}::uuid FOR UPDATE`;
    const current = await tx.cmoHire.findUnique({
      where: { id: hire.id },
      select: { brandBrain: true },
    });
    const brain = parseCmoBrandBrain(current?.brandBrain);
    const question = brain?.questions.find(
      (candidate) => candidate.id === input.questionId,
    );
    if (!brain || !question) {
      throw new CmoNotFoundError("That question is not in the Brand Brain");
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
    await tx.cmoHire.update({
      where: { id: hire.id },
      data: {
        brandBrain: {
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
export function cmoBrandSectionsSaved(value: unknown): CmoBrandSectionKey[] {
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
