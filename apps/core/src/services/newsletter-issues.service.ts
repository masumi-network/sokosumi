import { randomBytes } from "node:crypto";
import type { Prisma } from "@sokosumi/database";
import slugify from "slugify";

import { conflict, notFound } from "@/helpers/error";
import {
  createPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
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
    issues: page,
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
  return issue;
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
    return tx.newsletterIssue.findUniqueOrThrow({ where: { id: issueId } });
  });
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
  const { count } = await prisma.newsletterIssue.deleteMany({ where });
  if (!count) throw conflict("Only draft or canceled issues can be deleted");
}
