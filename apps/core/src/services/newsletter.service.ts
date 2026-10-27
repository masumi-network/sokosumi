import { randomBytes } from "node:crypto";
import type { NewsletterSubscriber, Prisma } from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";
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
import type { AuthenticationContext } from "@/middleware/auth";
import type {
  AddNewsletterSubscriberRequest,
  ListNewsletterSubscribersQuery,
  PatchNewsletterSubscriberRequest,
  PutNewsletterRequest,
} from "@/schemas/newsletter.schema";
import {
  inContactTransaction,
  resolveContactActor,
  resolveContactSummaries,
} from "@/services/contacts.service";
import { linkNewsletterContacts } from "@/services/newsletter-contacts.service";
import { requireScopedProject } from "@/services/project-social-connections.service";

export interface NewsletterScope {
  projectId: string;
  workspaceId: string;
}

export async function getNewsletter(
  scope: NewsletterScope,
  client: Pick<Prisma.TransactionClient, "project" | "newsletter"> = prisma,
) {
  await requireScopedProject(scope, { client });
  const newsletter = await client.newsletter.findUnique({ where: scope });
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
    OR: query.search
      ? [
          { email: { contains: query.search, mode: "insensitive" } },
          {
            contact: { name: { contains: query.search, mode: "insensitive" } },
          },
          // Contact merges flatten all tombstones to the surviving person.
          {
            contact: {
              mergedInto: {
                name: { contains: query.search, mode: "insensitive" },
              },
            },
          },
        ]
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
  const contacts = await resolveContactSummaries(
    prisma,
    newsletter.workspaceId,
    page.flatMap((subscriber) =>
      subscriber.contactId ? [subscriber.contactId] : [],
    ),
  );
  return {
    subscribers: page.map((subscriber) => ({
      ...subscriber,
      contact: subscriber.contactId
        ? (contacts.get(subscriber.contactId) ?? null)
        : null,
    })),
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
  auth: AuthenticationContext,
) {
  const newsletter = await getNewsletter(scope);
  const actor = await resolveContactActor(auth, scope.workspaceId);
  return inContactTransaction(async (tx) => {
    const contacts = await linkNewsletterContacts(
      tx,
      newsletter.id,
      actor,
      [input],
      "MANUAL",
    );
    const contact = contacts.get(input.email);
    if (!contact) throw notFound("Contact not found");
    const now = new Date();
    try {
      const subscriber = await tx.newsletterSubscriber.create({
        data: {
          newsletterId: newsletter.id,
          contactId: contact.id,
          email: input.email,
          name: input.name,
          status: "ACTIVE",
          source: "MANUAL",
          consentAt: now,
          events: {
            create: {
              newsletterId: newsletter.id,
              type: "CONFIRMED",
              occurredAt: now,
            },
          },
        },
      });
      return { ...subscriber, contact };
    } catch (error) {
      if (isPrismaUniqueViolation(error)) {
        throw conflict("Email is already subscribed to this newsletter");
      }
      throw error;
    }
  });
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
  // Only ACTIVE -> UNSUBSCRIBED changes status; record it for analytics.
  const unsubscribed =
    input.status === "UNSUBSCRIBED" && subscriber.status === "ACTIVE";
  const now = new Date();
  let updated: NewsletterSubscriber;
  try {
    updated = await prisma.newsletterSubscriber.update({
      where: {
        ...where,
        ...(input.status ? { status: subscriber.status } : {}),
      },
      data: {
        name: input.name,
        ...(unsubscribed
          ? {
              status: "UNSUBSCRIBED",
              unsubscribedAt: now,
              events: {
                create: {
                  newsletterId: newsletter.id,
                  type: "UNSUBSCRIBED",
                  occurredAt: now,
                },
              },
            }
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
  const contacts = await resolveContactSummaries(
    prisma,
    scope.workspaceId,
    updated.contactId ? [updated.contactId] : [],
  );
  return {
    ...updated,
    contact: updated.contactId
      ? (contacts.get(updated.contactId) ?? null)
      : null,
  };
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
  auth: AuthenticationContext,
) {
  const newsletter = await getNewsletter(scope);
  const actor = await resolveContactActor(auth, scope.workspaceId);
  const { subscribers, validRows, invalid } = parseNewsletterCsv(csv);
  const consentAt = new Date();
  let imported = 0;
  // Keep each insert below PostgreSQL's parameter limit for a 50k-row import.
  for (let offset = 0; offset < subscribers.length; offset += 1000) {
    const chunk = subscribers.slice(offset, offset + 1000);
    imported += await inContactTransaction(async (tx) => {
      const contacts = await linkNewsletterContacts(
        tx,
        newsletter.id,
        actor,
        chunk,
        "IMPORT",
      );
      const created = await tx.newsletterSubscriber.createManyAndReturn({
        data: chunk.map((subscriber) => {
          const contact = contacts.get(subscriber.email);
          if (!contact) throw notFound("Contact not found");
          return {
            ...subscriber,
            newsletterId: newsletter.id,
            contactId: contact.id,
            status: "ACTIVE",
            source: "CSV_IMPORT",
            consentAt,
          };
        }),
        skipDuplicates: true,
        select: { id: true },
      });
      if (created.length) {
        await tx.newsletterEvent.createMany({
          data: created.map(({ id }) => ({
            newsletterId: newsletter.id,
            subscriberId: id,
            type: "CONFIRMED",
            occurredAt: consentAt,
          })),
        });
      }
      // Existing subscriptions retain status and consent; only their person link changes.
      await tx.$executeRaw(PrismaRaw.sql`
        UPDATE "newsletter_subscriber" AS subscriber
        SET "contactId" = links."contactId"
        FROM (VALUES ${PrismaRaw.join([...contacts].map(([email, contact]) => PrismaRaw.sql`(${email}, ${contact.id}::uuid)`))}) AS links(email, "contactId")
        WHERE subscriber."newsletterId" = ${newsletter.id}::uuid
          AND subscriber.email = links.email
          AND subscriber."contactId" IS DISTINCT FROM links."contactId"
      `);
      return created.length;
    });
  }
  return { imported, skippedExisting: validRows - imported, invalid };
}
