import { randomBytes } from "node:crypto";
import type {
  Newsletter,
  NewsletterSubscriber,
  NewsletterSubscriberSource,
  Prisma,
} from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";
import slugify from "slugify";

import { conflict, notFound, tooManyRequests } from "@/helpers/error";
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
import { allowNewsletterSignup } from "@/lib/newsletter/signup-limit";
import type { AuthenticationContext } from "@/middleware/auth";
import type {
  AddNewsletterSubscriberRequest,
  AddNewsletterSubscribersFromContactsRequest,
  ImportNewsletterSubscribersRequest,
  ListNewsletterSubscribersQuery,
  NewsletterConsent,
  PatchNewsletterSubscriberRequest,
  PutNewsletterRequest,
} from "@/schemas/newsletter.schema";
import {
  type ContactActor,
  contactListWhere,
  inContactTransaction,
  resolveContactActor,
  resolveContactSummaries,
} from "@/services/contacts.service";
import { linkNewsletterContacts } from "@/services/newsletter-contacts.service";
import { sendNewsletterConfirmation } from "@/services/newsletter-signup.service";
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
  request: Request,
) {
  const newsletter = await getNewsletter(scope);
  const actor = await resolveContactActor(auth, scope.workspaceId);
  await requireConfirmationBudget(newsletter.id, input.consent, request);
  const result = await createSubscriberChunk(
    newsletter,
    [input],
    input.consent,
    "MANUAL",
    actor,
  );
  const subscriber = result.created[0];
  if (!subscriber) {
    if (result.skippedUnsubscribed)
      throw conflict(
        "This person unsubscribed; they cannot be subscribed again",
      );
    if (result.skippedBounced)
      throw conflict(
        "This person's email bounced; they cannot be subscribed again",
      );
    throw conflict("Email is already subscribed to this newsletter");
  }
  return {
    ...subscriber,
    contact: result.contacts.get(subscriber.email) ?? null,
  };
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
  input: ImportNewsletterSubscribersRequest,
  auth: AuthenticationContext,
  request: Request,
) {
  const newsletter = await getNewsletter(scope);
  const actor = await resolveContactActor(auth, scope.workspaceId);
  const { subscribers, validRows, invalid } = parseNewsletterCsv(input.csv);
  await requireConfirmationBudget(newsletter.id, input.consent, request);
  const result = await createSubscriberChunks(
    newsletter,
    subscribers,
    input.consent,
    "CSV_IMPORT",
    actor,
  );
  return {
    imported: result.added,
    skippedExisting: validRows - result.added,
    skippedUnsubscribed: result.skippedUnsubscribed,
    skippedBounced: result.skippedBounced,
    pendingConfirmation: result.pendingConfirmation,
    invalid,
  };
}

export async function addNewsletterSubscribersFromContacts(
  scope: NewsletterScope,
  input: AddNewsletterSubscribersFromContactsRequest,
  auth: AuthenticationContext,
  request: Request,
) {
  const newsletter = await getNewsletter(scope);
  const actor = await resolveContactActor(auth, scope.workspaceId);
  const resolved = await resolveContactSummaries(prisma, scope.workspaceId, [
    ...new Set(input.contactIds ?? []),
  ]);
  if ([...resolved.values()].some((contact) => !contact))
    throw notFound("Contact not found");
  const ids = [
    ...new Set(
      [...resolved.values()].flatMap((contact) =>
        contact ? [contact.id] : [],
      ),
    ),
  ];
  const lists = await Promise.all(
    [...new Set(input.listIds ?? [])].map((listId) =>
      contactListWhere(actor, { filter: {}, listId }),
    ),
  );
  const contacts = await prisma.contact.findMany({
    where: {
      workspaceId: scope.workspaceId,
      archivedAt: null,
      mergedIntoId: null,
      OR: [{ id: { in: ids } }, ...lists],
    },
    select: {
      id: true,
      name: true,
      channels: {
        where: { type: "EMAIL" },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }, { id: "asc" }],
        take: 1,
        select: { value: true },
      },
    },
  });
  const subscribers = contacts.flatMap((contact) =>
    contact.channels[0]
      ? [{ email: contact.channels[0].value, name: contact.name }]
      : [],
  );
  await requireConfirmationBudget(newsletter.id, input.consent, request);
  const result = await createSubscriberChunks(
    newsletter,
    subscribers,
    input.consent,
    "CONTACTS",
    actor,
  );
  return { ...result, skippedNoEmail: contacts.length - subscribers.length };
}

async function requireConfirmationBudget(
  newsletterId: string,
  consent: NewsletterConsent,
  request: Request,
) {
  if (
    consent === "ASK" &&
    !(await allowNewsletterSignup(newsletterId, request))
  ) {
    throw tooManyRequests("Too many confirmation requests; try again later", {
      retryAfterSeconds: 600,
    });
  }
}

async function createSubscriberChunks(
  newsletter: Newsletter,
  subscribers: { email: string; name?: string | null }[],
  consent: NewsletterConsent,
  source: NewsletterSubscriberSource,
  actor: ContactActor,
) {
  const result = {
    added: 0,
    alreadySubscribed: 0,
    skippedUnsubscribed: 0,
    skippedBounced: 0,
    pendingConfirmation: 0,
  };
  // Keep each insert below PostgreSQL's parameter limit for a 50k-row import.
  for (let offset = 0; offset < subscribers.length; offset += 1000) {
    const chunk = await createSubscriberChunk(
      newsletter,
      subscribers.slice(offset, offset + 1000),
      consent,
      source,
      actor,
    );
    result.added += chunk.created.length;
    result.alreadySubscribed += chunk.alreadySubscribed;
    result.skippedUnsubscribed += chunk.skippedUnsubscribed;
    result.skippedBounced += chunk.skippedBounced;
    result.pendingConfirmation += chunk.pendingConfirmation;
  }
  return result;
}

async function createSubscriberChunk(
  newsletter: Newsletter,
  subscribers: { email: string; name?: string | null }[],
  consent: NewsletterConsent,
  source: NewsletterSubscriberSource,
  actor: ContactActor,
) {
  const consentAt = new Date();
  const result = await inContactTransaction(async (tx) => {
    const contacts = await linkNewsletterContacts(
      tx,
      newsletter.id,
      actor,
      subscribers,
      source === "CSV_IMPORT"
        ? "IMPORT"
        : source === "MANUAL"
          ? "MANUAL"
          : "OTHER",
    );
    const created = await tx.newsletterSubscriber.createManyAndReturn({
      data: subscribers.map((subscriber) => {
        const contact = contacts.get(subscriber.email);
        if (!contact) throw notFound("Contact not found");
        return {
          email: subscriber.email,
          name: subscriber.name,
          newsletterId: newsletter.id,
          contactId: contact.id,
          status: consent === "ASK" ? "PENDING" : "ACTIVE",
          source,
          consentAt,
        };
      }),
      skipDuplicates: true,
    });
    const existing =
      created.length < subscribers.length
        ? await tx.newsletterSubscriber.findMany({
            where: {
              newsletterId: newsletter.id,
              email: { in: subscribers.map((subscriber) => subscriber.email) },
              id: { notIn: created.map((subscriber) => subscriber.id) },
            },
            select: { status: true },
          })
        : [];
    // Suppressed rows remain untouched; only fill missing links on current subscriptions.
    if (existing.length)
      await tx.$executeRaw(PrismaRaw.sql`
        UPDATE "newsletter_subscriber" AS subscriber
        SET "contactId" = links."contactId"
        FROM (VALUES ${PrismaRaw.join([...contacts].map(([email, contact]) => PrismaRaw.sql`(${email}, ${contact.id}::uuid)`))}) AS links(email, "contactId")
        WHERE subscriber."newsletterId" = ${newsletter.id}::uuid
          AND subscriber.email = links.email
          AND subscriber."contactId" IS NULL
          AND subscriber.status IN ('ACTIVE', 'PENDING')
      `);
    if (created.length)
      await tx.newsletterEvent.createMany({
        data: created.map((subscriber) => ({
          newsletterId: newsletter.id,
          subscriberId: subscriber.id,
          type: consent === "ASK" ? "SUBSCRIBED" : "CONFIRMED",
          occurredAt: consentAt,
        })),
      });
    return {
      contacts,
      created,
      alreadySubscribed: existing.filter(
        (subscriber) =>
          subscriber.status === "ACTIVE" || subscriber.status === "PENDING",
      ).length,
      skippedUnsubscribed: existing.filter(
        (subscriber) => subscriber.status === "UNSUBSCRIBED",
      ).length,
      skippedBounced: existing.filter(
        (subscriber) => subscriber.status === "BOUNCED",
      ).length,
      pendingConfirmation: consent === "ASK" ? created.length : 0,
    };
  });
  if (consent === "ASK") {
    for (const subscriber of result.created)
      await sendNewsletterConfirmation(newsletter, {
        ...subscriber,
        consentAt,
      });
  }
  return result;
}
