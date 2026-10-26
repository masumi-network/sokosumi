import { randomBytes } from "node:crypto";
import type { Prisma } from "@sokosumi/database";
import slugify from "slugify";

import { conflict, notFound } from "@/helpers/error";
import {
  createPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
import {
  isPrismaRecordNotFoundError,
  isPrismaUniqueViolation,
} from "@/helpers/prisma";
import prisma from "@/lib/db/prisma";
import { parseNewsletterCsv } from "@/lib/newsletter/csv";
import type {
  AddNewsletterSubscriberRequest,
  ListNewsletterSubscribersQuery,
  PatchNewsletterSubscriberRequest,
  PutNewsletterRequest,
} from "@/schemas/newsletter.schema";
import { requireScopedProject } from "@/services/project-social-connections.service";

export interface NewsletterScope {
  projectId: string;
  workspaceId: string;
}

export async function getNewsletter(scope: NewsletterScope) {
  await requireScopedProject(scope);
  const newsletter = await prisma.newsletter.findUnique({ where: scope });
  if (!newsletter) throw notFound("Newsletter not found");
  return newsletter;
}

export async function putNewsletter(
  scope: NewsletterScope,
  input: PutNewsletterRequest,
) {
  await requireScopedProject(scope);
  const data = {
    ...input,
    welcomeSubject: input.welcomeSubject ?? null,
    welcomeBody: input.welcomeBody ?? null,
  };
  for (let attempt = 0; ; attempt++) {
    const publicSlug = `${slugify(input.name, { lower: true, strict: true }) || "newsletter"}-${randomBytes(4).toString("hex")}`;
    try {
      return await prisma.newsletter.upsert({
        where: scope,
        create: { ...scope, ...data, publicSlug },
        update: data,
      });
    } catch (error) {
      if (!isPrismaUniqueViolation(error)) throw error;
      if (attempt >= 2)
        throw conflict("Newsletter slug is taken; retry saving");
    }
  }
}

export async function listNewsletterSubscribers(
  scope: NewsletterScope,
  query: ListNewsletterSubscribersQuery,
) {
  const newsletter = await getNewsletter(scope);
  const { cursor, take, skip } = parseCursorPagination(query);
  const where: Prisma.NewsletterSubscriberWhereInput = {
    newsletterId: newsletter.id,
    status: query.status,
    email: query.search
      ? { contains: query.search, mode: "insensitive" }
      : undefined,
  };
  const [subscribers, total, groups] = await Promise.all([
    prisma.newsletterSubscriber.findMany({
      where,
      cursor: cursor ? { id: cursor } : undefined,
      take: take + 1,
      skip,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
    prisma.newsletterSubscriber.count({ where }),
    prisma.newsletterSubscriber.groupBy({
      by: ["status"],
      where: { newsletterId: newsletter.id },
      _count: { _all: true },
    }),
  ]);
  const counts = { PENDING: 0, ACTIVE: 0, UNSUBSCRIBED: 0, BOUNCED: 0 };
  for (const group of groups) counts[group.status] = group._count._all;
  const page = subscribers.slice(0, take);
  return {
    subscribers: page,
    counts,
    pagination: createPaginationMeta(
      page,
      total,
      take,
      subscribers.length > take,
      cursor,
    ),
  };
}

export async function addNewsletterSubscriber(
  scope: NewsletterScope,
  input: AddNewsletterSubscriberRequest,
) {
  const newsletter = await getNewsletter(scope);
  try {
    return await prisma.newsletterSubscriber.create({
      data: {
        newsletterId: newsletter.id,
        email: input.email,
        name: input.name,
        status: "ACTIVE",
        source: "MANUAL",
        consentAt: new Date(),
      },
    });
  } catch (error) {
    if (isPrismaUniqueViolation(error)) {
      throw conflict("Email is already subscribed to this newsletter");
    }
    throw error;
  }
}

export async function patchNewsletterSubscriber(
  scope: NewsletterScope,
  subscriberId: string,
  input: PatchNewsletterSubscriberRequest,
) {
  const newsletter = await getNewsletter(scope);
  const where = { id: subscriberId, newsletterId: newsletter.id };
  const subscriber = await prisma.newsletterSubscriber.findUnique({ where });
  if (!subscriber) throw notFound("Subscriber not found");
  if (
    input.status &&
    subscriber.status !== "ACTIVE" &&
    !(subscriber.status === "UNSUBSCRIBED" && input.status === "UNSUBSCRIBED")
  ) {
    throw conflict(
      "Unsubscribed, pending and bounced subscribers cannot change status manually",
    );
  }
  try {
    return await prisma.newsletterSubscriber.update({
      where: {
        ...where,
        ...(input.status ? { status: subscriber.status } : {}),
      },
      data: {
        name: input.name,
        status: input.status,
        ...(input.status === "UNSUBSCRIBED" && subscriber.status === "ACTIVE"
          ? { unsubscribedAt: new Date() }
          : {}),
      },
    });
  } catch (error) {
    if (isPrismaRecordNotFoundError(error)) {
      if (input.status)
        throw conflict("Subscriber status changed; reload and try again");
      throw notFound("Subscriber not found");
    }
    throw error;
  }
}

export async function deleteNewsletterSubscriber(
  scope: NewsletterScope,
  subscriberId: string,
) {
  const newsletter = await getNewsletter(scope);
  const where = { id: subscriberId, newsletterId: newsletter.id };
  const { count } = await prisma.newsletterSubscriber.deleteMany({
    where: { ...where, status: { in: ["ACTIVE", "PENDING"] } },
  });
  if (!count) {
    const subscriber = await prisma.newsletterSubscriber.findUnique({ where });
    if (subscriber)
      throw conflict("Unsubscribed and bounced subscribers must be retained");
    throw notFound("Subscriber not found");
  }
}

export async function importNewsletterSubscribers(
  scope: NewsletterScope,
  csv: string,
) {
  const newsletter = await getNewsletter(scope);
  const { subscribers, validRows, invalid } = parseNewsletterCsv(csv);
  const consentAt = new Date();
  let imported = 0;
  // Keep each insert below PostgreSQL's parameter limit for a 50k-row import.
  for (let offset = 0; offset < subscribers.length; offset += 1000) {
    const result = await prisma.newsletterSubscriber.createMany({
      data: subscribers.slice(offset, offset + 1000).map((subscriber) => ({
        ...subscriber,
        newsletterId: newsletter.id,
        status: "ACTIVE",
        source: "CSV_IMPORT",
        consentAt,
      })),
      skipDuplicates: true,
    });
    imported += result.count;
  }
  return { imported, skippedExisting: validRows - imported, invalid };
}
