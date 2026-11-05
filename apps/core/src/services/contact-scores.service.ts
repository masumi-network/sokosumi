/**
 * Per-teammate contact scores. Familiarity is arithmetic over the
 * teammate's own interactions, so it costs nothing and is never stale for
 * long. Importance is Jev's judgement of the contact and those interactions,
 * asked again when the teammate has new ones; the teammate or their Soko Bot
 * can set it instead, and a set value is never overwritten by Jev.
 */
import type { ContactImportanceSource, Prisma } from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";
import { notFound } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import { askJev } from "@/lib/soko-bot/jev";

type Tx = Prisma.TransactionClient;

export interface ContactScoreDto {
  familiarity: number;
  importance: number | null;
  importanceSource: ContactImportanceSource | null;
  importanceReason: string | null;
}

/**
 * Recomputes familiarity for every teammate with interactions on `contactId`,
 * or on every contact of `workspaceId`: volume (log, full at 30), how much of
 * it the contact wrote (full at half), meetings and calls (full at 3), all
 * faded by recency with a 180-day half-life-ish decay to a 35% floor.
 * Teammates whose interactions were removed drop to 0. Only rows whose
 * value changed are written, so a whole-workspace run is cheap.
 */
export async function refreshContactFamiliarity(
  tx: Tx,
  scope: { contactId: string } | { workspaceId: string },
): Promise<void> {
  const where =
    "contactId" in scope
      ? PrismaRaw.sql`i."contactId" = ${scope.contactId}::uuid`
      : PrismaRaw.sql`i."workspaceId" = ${scope.workspaceId}::uuid`;
  const reset =
    "contactId" in scope
      ? PrismaRaw.sql`s."contactId" = ${scope.contactId}::uuid`
      : PrismaRaw.sql`s."workspaceId" = ${scope.workspaceId}::uuid`;
  await tx.$executeRaw`
    UPDATE contact_score s SET familiarity = 0, "updatedAt" = now()
    WHERE ${reset} AND s.familiarity <> 0 AND NOT EXISTS (
      SELECT 1 FROM contact_interaction i
      WHERE i."contactId" = s."contactId" AND i."userId" = s."userId"
    )
  `;
  await tx.$executeRaw`
    INSERT INTO contact_score (id, "workspaceId", "contactId", "userId", familiarity, "updatedAt")
    SELECT gen_random_uuid(), i."workspaceId", i."contactId", i."userId",
      round(100 * (
          0.45 * least(1, ln(1 + count(*)) / ln(31))
        + 0.30 * least(1, 2.0 * count(*) FILTER (WHERE i.direction IN ('IN', 'BOTH')) / count(*))
        + 0.25 * least(1, count(*) FILTER (WHERE i.channel IN ('MEETING', 'CALL')) / 3.0)
      ) * (0.35 + 0.65 * exp(-greatest(0, extract(epoch FROM (now() - max(i."occurredAt")))) / 86400 / 180)))::int,
      now()
    FROM contact_interaction i
    WHERE ${where} AND i."userId" IS NOT NULL
    GROUP BY i."workspaceId", i."contactId", i."userId"
    ON CONFLICT ("contactId", "userId")
    DO UPDATE SET familiarity = EXCLUDED.familiarity, "updatedAt" = now()
    WHERE contact_score.familiarity IS DISTINCT FROM EXCLUDED.familiarity
  `;
}

/** The reader's scores for these contacts; a contact they never met has none. */
export async function readerScores(
  tx: Tx,
  userId: string,
  contactIds: string[],
): Promise<Map<string, ContactScoreDto>> {
  if (!contactIds.length) return new Map();
  const rows = await tx.contactScore.findMany({
    where: { userId, contactId: { in: contactIds } },
    select: {
      contactId: true,
      familiarity: true,
      importance: true,
      importanceSource: true,
      importanceReason: true,
    },
  });
  return new Map(rows.map(({ contactId, ...score }) => [contactId, score]));
}

/**
 * Sets how much a contact matters to `userId`, from them or their Soko Bot.
 * Null hands the score back to Jev, which judges it on its next run.
 */
export async function setContactImportance(
  tx: Tx,
  input: {
    workspaceId: string;
    userId: string;
    contactId: string;
    importance: number | null;
    source: Exclude<ContactImportanceSource, "JEV">;
  },
): Promise<void> {
  const contact = await tx.contact.findFirst({
    where: {
      id: input.contactId,
      workspaceId: input.workspaceId,
      mergedIntoId: null,
    },
    select: { id: true },
  });
  if (!contact) throw notFound("Contact not found");
  const fields =
    input.importance === null
      ? {
          importance: null,
          importanceSource: null,
          importanceReason: null,
          importanceJudgedAt: null,
          importanceJudgedAtCount: 0,
        }
      : {
          importance: input.importance,
          importanceSource: input.source,
          importanceReason: null,
          importanceJudgedAt: new Date(),
        };
  await tx.contactScore.upsert({
    where: {
      contactId_userId: { contactId: input.contactId, userId: input.userId },
    },
    create: {
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      userId: input.userId,
      ...fields,
    },
    update: fields,
  });
}

/** What each answer adds to importance; `noise` takes most of it away. */
const IMPORTANCE_QUESTIONS = {
  decides:
    "Does this person make or strongly influence decisions about money, partnerships or hiring at their organization (founder, executive, partner, investor, senior lead)?",
  value:
    "Could this person materially move the reader's work forward, as an investor, customer, partner, key collaborator, advisor or journalist?",
  active:
    "Is there live business between the reader and this person right now: an open deal, project, introduction, or a conversation waiting on a next step?",
  close:
    "Is this a close or long-standing relationship for the reader (friend, mentor, trusted peer) rather than a passing contact?",
  noise:
    "Is this contact an automated sender, mass mailing, cold vendor pitch or support desk, or otherwise someone the reader does not need to deal with personally?",
} as const;

/** The answers that can explain a score, strongest first. */
const REASON_KEYS = ["decides", "value", "active", "close"] as const;

/**
 * Importance from Jev's answers. The reason is the keys of the strongest
 * yeses ("decides,value"), or "noise", for the reader's language to name.
 */
export function importanceFromAnswers(answers: Map<string, number>): {
  importance: number;
  reason: string | null;
} {
  const p = (key: keyof typeof IMPORTANCE_QUESTIONS) => answers.get(key) ?? 0;
  const base =
    0.3 * p("decides") +
    0.35 * p("value") +
    0.25 * p("active") +
    0.1 * p("close");
  const importance = Math.round(100 * base * (1 - 0.8 * p("noise")));
  const reasons = REASON_KEYS.filter((key) => p(key) >= 0.6).sort(
    (a, b) => p(b) - p(a),
  );
  return {
    importance,
    reason:
      p("noise") >= 0.6 ? "noise" : reasons.length ? reasons.join(",") : null,
  };
}

const JEV_TIMEOUT_MS = 15_000;
/** Interactions shown to Jev, newest first. */
const RECENT_INTERACTIONS = 10;

export interface ImportanceStats {
  judged: number;
  failed: number;
}

/**
 * Asks Jev about the teammate/contact pairs that need it: never judged, or
 * new interactions since the last judgement. A score the teammate or their
 * Soko Bot set stays. Newest conversations first, within `budget` calls.
 */
export async function judgeWorkspaceImportance(input: {
  workspaceId: string;
  budget: number;
  stats: ImportanceStats;
  shouldContinue: () => boolean;
}): Promise<void> {
  const pending = await prisma.$queryRaw<
    { contactId: string; userId: string; interactions: number }[]
  >`
    SELECT i."contactId", i."userId", count(*)::int AS interactions
    FROM contact_interaction i
    JOIN contact c ON c.id = i."contactId"
      AND c."mergedIntoId" IS NULL AND c."archivedAt" IS NULL
    LEFT JOIN contact_score s
      ON s."contactId" = i."contactId" AND s."userId" = i."userId"
    WHERE i."workspaceId" = ${input.workspaceId}::uuid AND i."userId" IS NOT NULL
      AND (s."importanceSource" IS NULL OR s."importanceSource" = 'JEV')
    GROUP BY i."contactId", i."userId", s."importanceJudgedAtCount", s."importanceSource"
    HAVING s."importanceSource" IS NULL OR count(*) > s."importanceJudgedAtCount"
    ORDER BY max(i."occurredAt") DESC
    LIMIT ${input.budget}
  `;
  for (const pair of pending) {
    if (!input.shouldContinue()) break;
    try {
      await judgePair(input.workspaceId, pair);
      input.stats.judged += 1;
    } catch (error) {
      input.stats.failed += 1;
      console.error("Contact importance failed", {
        contactId: pair.contactId,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }
}

async function judgePair(
  workspaceId: string,
  pair: { contactId: string; userId: string; interactions: number },
) {
  const [contact, user, recent] = await Promise.all([
    prisma.contact.findUniqueOrThrow({
      where: { id: pair.contactId },
      select: {
        name: true,
        kind: true,
        organization: true,
        role: true,
        stage: true,
        summary: true,
        whyInteresting: true,
      },
    }),
    prisma.user.findUniqueOrThrow({
      where: { id: pair.userId },
      select: { name: true },
    }),
    prisma.contactInteraction.findMany({
      where: { contactId: pair.contactId, userId: pair.userId },
      orderBy: { occurredAt: "desc" },
      take: RECENT_INTERACTIONS,
      select: {
        occurredAt: true,
        channel: true,
        direction: true,
        summary: true,
      },
    }),
  ]);
  const answers = await askJev({
    state: {
      reader: user.name,
      contact,
      interactionsWithReader: pair.interactions,
      recentInteractions: recent.map((entry) => ({
        ...entry,
        occurredAt: entry.occurredAt.toISOString().slice(0, 10),
      })),
    },
    questions: IMPORTANCE_QUESTIONS,
    timeoutMs: JEV_TIMEOUT_MS,
  });
  const { importance, reason } = importanceFromAnswers(answers);
  const fields = {
    importance,
    importanceSource: "JEV" as const,
    importanceReason: reason,
    importanceJudgedAt: new Date(),
    importanceJudgedAtCount: pair.interactions,
  };
  // A score the teammate or their bot set meanwhile wins: only an unset or
  // Jev-judged score is updated, and a missing row is created.
  const updated = await prisma.contactScore.updateMany({
    where: {
      contactId: pair.contactId,
      userId: pair.userId,
      OR: [{ importanceSource: null }, { importanceSource: "JEV" }],
    },
    data: fields,
  });
  if (!updated.count)
    await prisma.contactScore.createMany({
      data: [
        {
          workspaceId,
          contactId: pair.contactId,
          userId: pair.userId,
          ...fields,
        },
      ],
      skipDuplicates: true,
    });
}
