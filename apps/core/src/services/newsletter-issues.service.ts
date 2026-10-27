import { randomBytes } from "node:crypto";
import {
  Channel,
  type NewsletterIssue,
  type Prisma,
  TaskStatus,
} from "@sokosumi/database";
import { CORE_API_ERROR_KINDS, canArchiveTaskStatus } from "@sokosumi/utils";
import slugify from "slugify";

import { getEnv } from "@/config/env";
import { conflict, notFound, unprocessableEntity } from "@/helpers/error";
import {
  createPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import { applyGuardedTaskStatusUpdate } from "@/helpers/task-event-charge";
import prisma from "@/lib/db/prisma";
import type {
  CreateNewsletterIssueRequest,
  ListNewsletterIssuesQuery,
  PatchNewsletterIssueRequest,
} from "@/schemas/newsletter.schema";
import {
  getNewsletter,
  type NewsletterScope,
} from "@/services/newsletter.service";
import {
  archiveTaskRecord,
  createTaskForActor,
  type TaskDomainActor,
} from "@/services/task-domain.service";

async function withApproverNames(issues: NewsletterIssue[]) {
  const ids = [
    ...new Set(
      issues.flatMap((issue) =>
        issue.approvedByUserId ? [issue.approvedByUserId] : [],
      ),
    ),
  ];
  const users = ids.length
    ? await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
      })
    : [];
  const names = new Map(users.map((user) => [user.id, user.name]));
  return issues.map((issue) => ({
    ...issue,
    approvedByName: issue.approvedByUserId
      ? (names.get(issue.approvedByUserId) ?? null)
      : null,
  }));
}

export async function listNewsletterIssues(
  scope: NewsletterScope,
  query: ListNewsletterIssuesQuery,
) {
  const newsletter = await getNewsletter(scope);
  const { cursor, take, skip } = parseCursorPagination(query);
  const where = { ...scope, newsletterId: newsletter.id, status: query.status };
  const [issues, total] = await Promise.all([
    prisma.newsletterIssue.findMany({
      where,
      cursor: cursor ? { id: cursor } : undefined,
      skip,
      take: take + 1,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
    prisma.newsletterIssue.count({ where }),
  ]);
  const page = issues.slice(0, take);
  return {
    issues: await withApproverNames(page),
    pagination: createPaginationMeta(
      page,
      total,
      take,
      issues.length > take,
      cursor,
    ),
  };
}

export async function createNewsletterIssue(
  scope: NewsletterScope,
  input: CreateNewsletterIssueRequest,
) {
  const newsletter = await getNewsletter(scope);
  for (let attempt = 0; ; attempt++) {
    const publicSlug = `${slugify(input.subject, { lower: true, strict: true }) || "issue"}-${randomBytes(4).toString("hex")}`;
    try {
      return await prisma.newsletterIssue.create({
        data: { ...scope, newsletterId: newsletter.id, ...input, publicSlug },
      });
    } catch (error) {
      if (!isPrismaUniqueViolation(error)) throw error;
      if (attempt >= 2) throw conflict("Issue slug is taken; retry creating");
    }
  }
}

export async function getNewsletterIssue(
  scope: NewsletterScope,
  issueId: string,
) {
  const newsletter = await getNewsletter(scope);
  const issue = await prisma.newsletterIssue.findUnique({
    where: { ...scope, id: issueId, newsletterId: newsletter.id },
  });
  if (!issue) throw notFound("Newsletter issue not found");
  return (await withApproverNames([issue]))[0]!;
}

export async function patchNewsletterIssue(
  scope: NewsletterScope,
  issueId: string,
  input: PatchNewsletterIssueRequest,
) {
  const issue = await getNewsletterIssue(scope, issueId);
  if (issue.status !== "DRAFT" && issue.status !== "NEEDS_APPROVAL") {
    throw conflict("Only draft or needs-approval issues can be edited");
  }
  if (issue.revision !== input.revision) {
    throw conflict("Newsletter issue changed; refresh and try again");
  }
  const { revision, ...content } = input;
  // Guard both revision and status against concurrent edits or scheduling.
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.newsletterIssue.updateMany({
      where: {
        ...scope,
        id: issueId,
        newsletterId: issue.newsletterId,
        revision,
        status: { in: ["DRAFT", "NEEDS_APPROVAL"] },
      },
      data: {
        ...content,
        status: "DRAFT",
        approvedAt: null,
        approvedByUserId: null,
        revision: { increment: 1 },
      },
    });
    if (!count)
      throw conflict("Newsletter issue changed; refresh and try again");
    await setApprovalTaskStatus(tx, issue, TaskStatus.READY);
    return tx.newsletterIssue.findUniqueOrThrow({ where: { id: issueId } });
  });
}

async function setApprovalTaskStatus(
  tx: Prisma.TransactionClient,
  issue: NewsletterIssue,
  status: "READY" | "COMPLETED",
  userId: string | null = null,
) {
  if (!issue.taskId) return;
  const task = await tx.task.findFirst({
    where: {
      id: issue.taskId,
      projectId: issue.projectId,
      workspaceId: issue.workspaceId,
      archivedAt: null,
    },
  });
  // An archived or moved Task must not block editing or cancelling delivery.
  if (!task) return null;
  if (task.status === status) return task;
  await applyGuardedTaskStatusUpdate({
    tx,
    taskId: task.id,
    expectedStatus: task.status,
    eventStatus: status,
  });
  await tx.taskEvent.create({
    data: { taskId: task.id, status, userId, channel: Channel.SOKOSUMI },
  });
  return task;
}

async function transitionNewsletterIssue(
  scope: NewsletterScope,
  issueId: string,
  revision: number,
  status: NewsletterIssue["status"],
  data: Prisma.NewsletterIssueUpdateManyMutationInput,
  effect?: (
    issue: NewsletterIssue,
    tx: Prisma.TransactionClient,
  ) => Promise<void>,
) {
  const issue = await getNewsletterIssue(scope, issueId);
  if (issue.status !== status || issue.revision !== revision) {
    throw conflict("Newsletter issue changed; refresh and try again");
  }
  const updated = await prisma.$transaction(async (tx) => {
    const { count } = await tx.newsletterIssue.updateMany({
      where: {
        ...scope,
        id: issue.id,
        newsletterId: issue.newsletterId,
        revision,
        status,
      },
      data: { ...data, revision: { increment: 1 } },
    });
    if (!count)
      throw conflict("Newsletter issue changed; refresh and try again");
    await effect?.(issue, tx);
    return tx.newsletterIssue.findUniqueOrThrow({ where: { id: issueId } });
  });
  return (await withApproverNames([updated]))[0]!;
}

export interface NewsletterTaskContext {
  actor: TaskDomainActor;
  ownerId: string | null;
  organizationId: string | null;
  humanUserId: string | null;
}

export function submitNewsletterIssue(
  scope: NewsletterScope,
  issueId: string,
  revision: number,
  context: NewsletterTaskContext,
) {
  return transitionNewsletterIssue(
    scope,
    issueId,
    revision,
    "DRAFT",
    {
      status: "NEEDS_APPROVAL",
      approvedAt: null,
      approvedByUserId: null,
    },
    async (issue, tx) => {
      if (issue.taskId) {
        const task = await setApprovalTaskStatus(
          tx,
          issue,
          TaskStatus.READY,
          context.humanUserId,
        );
        if (task) {
          await tx.task.update({
            where: { id: task.id },
            data: {
              name: `Approve newsletter: ${issue.subject}`,
              assigneeId: null,
              assigneeSokoBotId: null,
              assigneeUserId: context.humanUserId,
            },
          });
          return;
        }
      }
      const task = await createTaskForActor(
        {
          actor: context.actor,
          ownerId: context.ownerId,
          organizationId: context.organizationId,
          ...scope,
          name: `Approve newsletter: ${issue.subject}`,
          assigneeUserId: context.humanUserId,
          status: TaskStatus.READY,
        },
        tx,
      );
      await tx.newsletterIssue.update({
        where: { id: issue.id },
        data: { taskId: task.id },
      });
    },
  );
}

export function approveNewsletterIssue(
  scope: NewsletterScope,
  issueId: string,
  revision: number,
  userId: string,
) {
  return transitionNewsletterIssue(
    scope,
    issueId,
    revision,
    "NEEDS_APPROVAL",
    {
      approvedByUserId: userId,
      approvedAt: new Date(),
    },
    async (issue, tx) => {
      if (issue.approvedAt)
        throw conflict("Newsletter issue is already approved");
      await setApprovalTaskStatus(tx, issue, TaskStatus.COMPLETED, userId);
    },
  );
}

export function scheduleNewsletterIssue(
  scope: NewsletterScope,
  issueId: string,
  revision: number,
  scheduledAt: Date,
  timezone: string,
  sendNow = false,
) {
  const now = Date.now();
  if (
    !sendNow &&
    (scheduledAt.getTime() < now + 60_000 ||
      scheduledAt.getTime() > now + 365 * 24 * 60 * 60_000)
  ) {
    throw unprocessableEntity(
      "Schedule between one minute and one year from now",
    );
  }
  return transitionNewsletterIssue(
    scope,
    issueId,
    revision,
    "NEEDS_APPROVAL",
    {
      status: "SCHEDULED",
      scheduledAt,
      timezone,
    },
    async (issue, tx) => {
      if (!issue.approvedAt || !issue.approvedByUserId) {
        throw conflict("A human must approve this newsletter issue first", {
          kind: CORE_API_ERROR_KINDS.NEWSLETTER_APPROVAL_REQUIRED,
        });
      }
      if (!getEnv().NEWSLETTER_FROM_DOMAIN) {
        throw conflict(
          "NEWSLETTER_FROM_DOMAIN is required to send newsletters",
          { kind: CORE_API_ERROR_KINDS.NEWSLETTER_SENDER_NOT_CONFIGURED },
        );
      }
      const subscribers = await tx.newsletterSubscriber.count({
        where: { newsletterId: issue.newsletterId, status: "ACTIVE" },
      });
      if (!subscribers) {
        throw conflict("Add at least one active subscriber before sending", {
          kind: CORE_API_ERROR_KINDS.NEWSLETTER_NO_ACTIVE_SUBSCRIBERS,
        });
      }
    },
  );
}

export function cancelNewsletterIssue(
  scope: NewsletterScope,
  issueId: string,
  revision: number,
) {
  return transitionNewsletterIssue(
    scope,
    issueId,
    revision,
    "SCHEDULED",
    {
      status: "DRAFT",
      scheduledAt: null,
      timezone: null,
      approvedAt: null,
      approvedByUserId: null,
    },
    async (issue, tx) => {
      await setApprovalTaskStatus(tx, issue, TaskStatus.READY);
    },
  );
}

export async function deleteNewsletterIssue(
  scope: NewsletterScope,
  issueId: string,
) {
  const issue = await getNewsletterIssue(scope, issueId);
  if (issue.status !== "DRAFT" && issue.status !== "CANCELED") {
    throw conflict("Only draft or canceled issues can be deleted");
  }
  const where: Prisma.NewsletterIssueWhereInput = {
    ...scope,
    id: issueId,
    newsletterId: issue.newsletterId,
    revision: issue.revision,
    status: { in: ["DRAFT", "CANCELED"] },
  };
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.newsletterIssue.deleteMany({ where });
    if (!count) throw conflict("Only draft or canceled issues can be deleted");
    if (!issue.taskId) return;
    // Close the approval Task so no open review is left for a deleted issue.
    const task = await tx.task.findFirst({
      where: {
        id: issue.taskId,
        projectId: issue.projectId,
        workspaceId: issue.workspaceId,
        archivedAt: null,
      },
    });
    if (task && canArchiveTaskStatus(task.status))
      await archiveTaskRecord(tx, task);
  });
}
