import type { Prisma } from "@sokosumi/database";

import { conflict, notFound, unprocessableEntity } from "@/helpers/error";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import { isNewsletterWorkspaceEnabled } from "@/lib/newsletter/feature";
import { createNewsletterIssueRequestSchema } from "@/schemas/newsletter.schema";
import { type Cuso, requireCuso } from "@/services/cmo-cuso.service";
import {
  approvedMarketingStrategy,
  parseMarketingPlan,
} from "@/services/marketing-strategy.service";
import { readMarketingPieceText } from "@/services/marketing-strategy-files.service";
import { createNewsletterIssue } from "@/services/newsletter-issues.service";

interface CalendarNewsletterInput {
  userId: string;
  projectId: string;
  strategyId: string;
  entryId: string;
  issueId?: string;
}

async function calendarSource(
  cuso: Cuso,
  input: CalendarNewsletterInput,
  db: Prisma.TransactionClient,
) {
  const strategy = await approvedMarketingStrategy(cuso.projectId, db);
  if (!strategy || strategy.id !== input.strategyId) {
    throw conflict(
      "The approved calendar changed. Reopen the piece and try again.",
    );
  }
  const entry = parseMarketingPlan(strategy.plan)?.calendar.find(
    (candidate) => candidate.id === input.entryId,
  );
  if (
    !entry ||
    (entry.channel !== "newsletter" && entry.channel !== "email") ||
    entry.status === "skipped"
  ) {
    throw notFound("Newsletter calendar piece not found");
  }
  const file = await db.marketingStrategyFile.findUnique({
    where: {
      marketingStrategyId_entryId: {
        marketingStrategyId: strategy.id,
        entryId: entry.id,
      },
      fileResource: { lifecycle: "ACTIVE" },
    },
    select: {
      id: true,
      newsletterIssueId: true,
      fileResourceId: true,
      fileResource: { select: { contentRevision: true, updatedAt: true } },
    },
  });
  if (!file) throw notFound("This newsletter piece is not written yet");
  return { file, title: entry.title };
}

function issueFromCopy(title: string, text: string | null) {
  const copy = text?.replace(/\r\n/g, "\n").trim() ?? "";
  const subject = /^Subject:[ \t]*([^\n]+)\n?/i.exec(copy);
  const afterSubject = copy.slice(subject?.[0].length ?? 0).trimStart();
  const preview = /^Preview:[ \t]*([^\n]+)\n?/i.exec(afterSubject);
  const body = afterSubject.slice(preview?.[0].length ?? 0).trim();
  if (!body) throw unprocessableEntity("The calendar draft has no email body");

  const result = createNewsletterIssueRequestSchema.safeParse({
    subject: subject?.[1].trim() || title,
    previewText: preview?.[1].trim(),
    template: "TEXT",
    content: body.split(/\n[ \t]*\n+/).flatMap((paragraph) => {
      const heading = /^#{1,2}[ \t]+([^\n]+)(?:\n|$)/.exec(paragraph);
      if (!heading) return [{ type: "text", text: paragraph }];
      const text = paragraph.slice(heading[0].length).trim();
      const block = { type: "heading", level: 2, text: heading[1] };
      return text ? [block, { type: "text", text }] : [block];
    }),
  });
  if (!result.success) {
    throw unprocessableEntity(
      "The calendar draft exceeds the newsletter content limits",
    );
  }
  return result.data;
}

/** Prepare one issue per written piece. Opening it again never changes its copy or approval. */
export async function prepareCalendarNewsletterIssue(
  input: CalendarNewsletterInput,
): Promise<string> {
  const cuso = await requireCuso({ userId: input.userId });
  if (cuso.projectId !== input.projectId) {
    throw conflict("The active business changed. Reopen the calendar.");
  }
  if (!(await isNewsletterWorkspaceEnabled(cuso.workspaceId))) {
    throw notFound("Newsletter is not enabled");
  }
  const scope = { projectId: cuso.projectId, workspaceId: cuso.workspaceId };
  const { file, title } = await calendarSource(cuso, input, prisma);
  if (file.newsletterIssueId) return file.newsletterIssueId;
  // Blob I/O stays outside the transaction. The transaction rechecks the source
  // so a new strategy or rewritten file cannot be linked to this older copy.
  const draft = input.issueId
    ? null
    : issueFromCopy(
        title,
        await readMarketingPieceText({ id: input.strategyId }, input.entryId),
      );

  try {
    return await serializableTransaction(async (tx) => {
      const { file: current } = await calendarSource(cuso, input, tx);
      if (current.newsletterIssueId) return current.newsletterIssueId;
      if (
        file.id !== current.id ||
        file.fileResourceId !== current.fileResourceId ||
        file.fileResource.contentRevision !==
          current.fileResource.contentRevision ||
        file.fileResource.updatedAt.getTime() !==
          current.fileResource.updatedAt.getTime()
      ) {
        throw conflict(
          "The calendar draft changed. Reopen the piece and try again.",
        );
      }

      const issue = draft
        ? await createNewsletterIssue(scope, draft, { client: tx })
        : await tx.newsletterIssue.findFirst({
            where: {
              ...scope,
              id: input.issueId,
              status: { in: ["DRAFT", "NEEDS_APPROVAL"] },
            },
            select: { id: true },
          });
      if (!issue) throw notFound("Newsletter draft not found in this project");
      await tx.marketingStrategyFile.update({
        where: { id: current.id },
        data: { newsletterIssueId: issue.id },
      });
      return issue.id;
    }, "The calendar piece changed. Reopen it and try again.");
  } catch (error) {
    if (isPrismaUniqueViolation(error)) {
      throw conflict(
        "That newsletter issue is already linked to another calendar piece",
      );
    }
    throw error;
  }
}
