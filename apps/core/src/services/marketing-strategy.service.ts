import { type MarketingStrategy, type Prisma } from "@sokosumi/database";
import {
  type CmoBrandAnswer,
  type CmoStrategy,
  cmoStrategySchema,
} from "@sokosumi/soko-bot";

import { conflict, forbidden, notFound } from "@/helpers/error";
import { isOrganizationOwnerOrAdmin } from "@/helpers/organization-role";
import { organizationRoleInWorkspace } from "@/helpers/soko-bot-management";
import prisma from "@/lib/db/prisma";
import {
  STRATEGY_TURN_PREFIX,
  settledTurnStatus,
  TURN_ROW_SELECT,
} from "@/services/cmo-cuso.service";

/**
 * A Project's Marketing strategy (ADR 0062): one row per version. A write
 * adds a version and never changes another; the Workspace's owners or
 * admins approve one, and only that one is carried out. Reverting approves
 * an older version again.
 */

export function parseMarketingPlan(value: unknown): CmoStrategy | null {
  const parsed = cmoStrategySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Every column but the plan: what a list of versions shows. */
export const MARKETING_STRATEGY_VERSION_SELECT = {
  id: true,
  projectId: true,
  createdAt: true,
  updatedAt: true,
  authorSokoBotId: true,
  authorUserId: true,
  turnId: true,
  approvedAt: true,
  approvedByUserId: true,
} as const satisfies Prisma.MarketingStrategySelect;

const NEWEST_FIRST = [
  { createdAt: "desc" },
  { id: "desc" },
] as const satisfies Prisma.MarketingStrategyOrderByWithRelationInput[];

/** The version being carried out, or null before any approval. */
export function approvedMarketingStrategy(
  projectId: string,
  db: Prisma.TransactionClient = prisma,
): Promise<MarketingStrategy | null> {
  return db.marketingStrategy.findFirst({
    where: { projectId, approvedAt: { not: null } },
  });
}

/** The latest version, approved or not. */
export function newestMarketingStrategy(
  projectId: string,
  db: Prisma.TransactionClient = prisma,
): Promise<MarketingStrategy | null> {
  return db.marketingStrategy.findFirst({
    where: { projectId },
    orderBy: [...NEWEST_FIRST],
  });
}

export function listMarketingStrategies(projectId: string) {
  return prisma.marketingStrategy.findMany({
    where: { projectId },
    orderBy: [...NEWEST_FIRST],
    select: MARKETING_STRATEGY_VERSION_SELECT,
  });
}

export async function getMarketingStrategy(
  projectId: string,
  strategyId: string,
): Promise<MarketingStrategy> {
  const version = await prisma.marketingStrategy.findFirst({
    where: { id: strategyId, projectId },
  });
  if (!version) throw notFound("Marketing strategy version not found");
  return version;
}

/**
 * Approving commits the business: the Workspace's organization owners and
 * admins, or a personal Workspace's owner.
 */
export async function mayApproveMarketingStrategy(
  userId: string,
  workspace: {
    id: string;
    userId: string | null;
    organizationId: string | null;
  },
  db: Prisma.TransactionClient = prisma,
): Promise<boolean> {
  if (!workspace.organizationId) return workspace.userId === userId;
  const role = await organizationRoleInWorkspace(userId, workspace.id, db);
  return role !== null && isOrganizationOwnerOrAdmin(role);
}

/** A strategy turn of the Project's bot still running: its version is not done. */
async function strategyBeingWritten(projectId: string): Promise<boolean> {
  const writing = await prisma.sokoBotTurn.findFirst({
    where: {
      sokoBot: { projectId },
      clientTurnId: { startsWith: STRATEGY_TURN_PREFIX },
    },
    orderBy: { createdAt: "desc" },
    select: TURN_ROW_SELECT,
  });
  if (!writing) return false;
  return (await settledTurnStatus(writing, new Date())) === "running";
}

/**
 * Approves one version and withdraws the approval of any other, so the
 * Project carries out exactly this one. Approving an older version reverts.
 */
export async function approveMarketingStrategy(input: {
  projectId: string;
  workspaceId: string;
  userId: string;
  strategyId: string;
}): Promise<MarketingStrategy> {
  const project = await prisma.project.findFirst({
    where: { id: input.projectId, workspaceId: input.workspaceId },
    select: {
      workspace: { select: { id: true, userId: true, organizationId: true } },
    },
  });
  if (!project) throw notFound("Project not found");
  if (!(await mayApproveMarketingStrategy(input.userId, project.workspace))) {
    throw forbidden(
      "Only the Workspace's owners and admins approve a Marketing strategy",
    );
  }
  if (await strategyBeingWritten(input.projectId)) {
    throw conflict(
      "A new version of the strategy is being written; approve when it is ready",
    );
  }
  return prisma.$transaction(async (tx) => {
    // One approval at a time per Project, so two never race the unique index.
    await tx.$executeRaw`SELECT 1 FROM project WHERE id = ${input.projectId}::uuid FOR UPDATE`;
    const version = await tx.marketingStrategy.findFirst({
      where: { id: input.strategyId, projectId: input.projectId },
    });
    if (!version) throw notFound("Marketing strategy version not found");
    if (version.approvedAt) return version;
    await tx.marketingStrategy.updateMany({
      where: { projectId: input.projectId, approvedAt: { not: null } },
      data: { approvedAt: null, approvedByUserId: null },
    });
    return tx.marketingStrategy.update({
      where: { id: version.id },
      data: { approvedAt: new Date(), approvedByUserId: input.userId },
    });
  });
}

/**
 * Answers one of a version's yes/no questions. Answers belong to their
 * version, so answering an older one never touches the current plan.
 */
export async function answerMarketingStrategyQuestion(input: {
  projectId: string;
  strategyId: string;
  questionId: string;
  answer: CmoBrandAnswer;
  note?: string;
}): Promise<MarketingStrategy> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM marketing_strategy WHERE id = ${input.strategyId}::uuid FOR UPDATE`;
    const version = await tx.marketingStrategy.findFirst({
      where: { id: input.strategyId, projectId: input.projectId },
    });
    const plan = parseMarketingPlan(version?.plan);
    if (!version || !plan) {
      throw notFound("Marketing strategy version not found");
    }
    if (!plan.questions.some((question) => question.id === input.questionId)) {
      throw notFound("That question is not in the plan");
    }
    const note =
      input.answer === "no" ? input.note?.trim() || undefined : undefined;
    return tx.marketingStrategy.update({
      where: { id: version.id },
      data: {
        plan: {
          ...plan,
          questions: plan.questions.map((question) =>
            question.id === input.questionId
              ? { ...question, answer: input.answer, note }
              : question,
          ),
        },
      },
    });
  });
}
