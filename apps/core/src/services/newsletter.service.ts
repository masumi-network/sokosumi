import { randomBytes } from "node:crypto";
import type {
  Newsletter,
  NewsletterSubscriber,
  NewsletterSubscriberSource,
  Prisma,
} from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";
import slugify from "slugify";

import {
  conflict,
  notFound,
  tooManyRequests,
  unprocessableEntity,
} from "@/helpers/error";
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
  resolveContactSummaries,
} from "@/services/contacts.service";
import { linkNewsletterContacts } from "@/services/newsletter-contacts.service";
import { sendNewsletterConfirmations } from "@/services/newsletter-signup.service";
import { requireScopedProject } from "@/services/project-social-connections.service";

export interface NewsletterScope {
  projectId: string;
  workspaceId: string;
}

/** Who adds subscribers, and whose confirmation-email budget it spends. */
export interface NewsletterSubscriberAdder {
  actor: ContactActor;
  /** The request's client IP, or the Soko Bot adding on its owner's word. */
  requester: Request | { sokoBotId: string };
}

/**
 * A Soko Bot's addition. People are counted once the CSV is parsed and lists
 * are expanded, before any write or email; the bot's authority check and its
 * action receipt run in the insert's transaction, so the receipt exists
 * exactly when the subscribers do.
 */
export interface NewsletterSubscriberWrite {
  maxPeople: number;
  authorize(tx: Prisma.TransactionClient): Promise<unknown>;
  commit(
    tx: Prisma.TransactionClient,
    targetId: string,
    result: unknown,
  ): Promise<unknown>;
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
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  await requireScopedProject(scope, { client });
  const data = {
    ...input,
    welcomeSubject: input.welcomeSubject ?? null,
    welcomeBody: input.welcomeBody ?? null,
  };
  for (let attempt = 0; ; attempt++) {
    const publicSlug = `${slugify(input.name, { lower: true, strict: true }) || "newsletter"}-${randomBytes(4).toString("hex")}`;
    try {
      return await client.newsletter.upsert({
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

/** Subscribers by status, for the whole newsletter. */
export async function countNewsletterSubscribers(newsletterId: string) {
  const groups = await prisma.newsletterSubscriber.groupBy({
    by: ["status"],
    where: { newsletterId },
    _count: { _all: true },
  });
  const counts = { PENDING: 0, ACTIVE: 0, UNSUBSCRIBED: 0, BOUNCED: 0 };
  for (const group of groups) counts[group.status] = group._count._all;
  return counts;
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
  const [subscribers, total, counts] = await Promise.all([
    prisma.newsletterSubscriber.findMany({
      where,
      cursor: cursor ? { id: cursor } : undefined,
      take: take + 1,
      skip,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
    prisma.newsletterSubscriber.count({ where }),
    countNewsletterSubscribers(newsletter.id),
  ]);
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
  adder: NewsletterSubscriberAdder,
  write?: NewsletterSubscriberWrite,
) {
  const newsletter = await getNewsletter(scope);
  await requireConfirmationBudget(
    newsletter.id,
    input.consent,
    1,
    adder.requester,
  );
  return addedSubscriber(
    await createSubscriberChunk(
      newsletter,
      [input],
      input.consent,
      "MANUAL",
      adder.actor,
      write && {
        authorize: write.authorize,
        // Nobody added rolls the bot's write back, receipt and all.
        commit: (tx, chunk) => {
          const added = addedSubscriber(chunk);
          return write.commit(tx, added.id, added);
        },
      },
    ),
  );
}

function addedSubscriber(result: SubscriberChunk) {
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
  client: Prisma.TransactionClient = prisma,
) {
  const newsletter = await getNewsletter(scope, client);
  const where = { id: subscriberId, newsletterId: newsletter.id };
  const subscriber = await client.newsletterSubscriber.findUnique({ where });
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
    updated = await client.newsletterSubscriber.update({
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
    client,
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
  client: Prisma.TransactionClient = prisma,
) {
  const newsletter = await getNewsletter(scope, client);
  const where = { id: subscriberId, newsletterId: newsletter.id };
  const { count } = await client.newsletterSubscriber.deleteMany({
    where: { ...where, status: { in: ["ACTIVE", "PENDING"] } },
  });
  if (!count) {
    const subscriber = await client.newsletterSubscriber.findUnique({ where });
    if (subscriber)
      throw conflict("Unsubscribed and bounced subscribers must be retained");
    throw notFound("Subscriber not found");
  }
}

export async function importNewsletterSubscribers(
  scope: NewsletterScope,
  input: ImportNewsletterSubscribersRequest,
  adder: NewsletterSubscriberAdder,
  write?: NewsletterSubscriberWrite,
) {
  const newsletter = await getNewsletter(scope);
  const { subscribers, validRows, invalid } = parseNewsletterCsv(input.csv);
  requireBotBatch(
    write,
    subscribers.length,
    subscribers.length,
    "The CSV has no valid email addresses",
  );
  await requireConfirmationBudget(
    newsletter.id,
    input.consent,
    subscribers.length,
    adder.requester,
  );
  const summary = (result: SubscriberTotals) => ({
    imported: result.added,
    skippedExisting: validRows - result.added,
    skippedUnsubscribed: result.skippedUnsubscribed,
    skippedBounced: result.skippedBounced,
    pendingConfirmation: result.pendingConfirmation,
    invalid,
  });
  return summary(
    await createSubscriberChunks(
      newsletter,
      subscribers,
      input.consent,
      "CSV_IMPORT",
      adder.actor,
      write && {
        authorize: write.authorize,
        commit: (tx, result) =>
          write.commit(tx, newsletter.id, summary(result)),
      },
    ),
  );
}

export async function addNewsletterSubscribersFromContacts(
  scope: NewsletterScope,
  input: AddNewsletterSubscribersFromContactsRequest,
  adder: NewsletterSubscriberAdder,
  write?: NewsletterSubscriberWrite,
) {
  const { actor } = adder;
  const newsletter = await getNewsletter(scope);
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
  requireBotBatch(
    write,
    contacts.length,
    subscribers.length,
    "None of these contacts has an email address",
  );
  await requireConfirmationBudget(
    newsletter.id,
    input.consent,
    subscribers.length,
    adder.requester,
  );
  const summary = (result: SubscriberTotals) => ({
    ...result,
    skippedNoEmail: contacts.length - subscribers.length,
  });
  return summary(
    await createSubscriberChunks(
      newsletter,
      subscribers,
      input.consent,
      "CONTACTS",
      adder.actor,
      write && {
        authorize: write.authorize,
        commit: (tx, result) =>
          write.commit(tx, newsletter.id, summary(result)),
      },
    ),
  );
}

/** One rate-limit token covers one request, so the request itself is bounded. */
export const NEWSLETTER_ASK_MAX_PEOPLE = 1000;

async function requireConfirmationBudget(
  newsletterId: string,
  consent: NewsletterConsent,
  people: number,
  requester: NewsletterSubscriberAdder["requester"],
) {
  if (consent === "ASK" && people > NEWSLETTER_ASK_MAX_PEOPLE)
    throw unprocessableEntity(
      `Ask them first works for up to ${NEWSLETTER_ASK_MAX_PEOPLE.toLocaleString("en-US")} people at a time`,
    );
  if (
    consent === "ASK" &&
    !(await allowNewsletterSignup(newsletterId, requester))
  ) {
    throw tooManyRequests("Too many confirmation requests; try again later", {
      retryAfterSeconds: 600,
    });
  }
}

/** Keeps each insert below PostgreSQL's parameter limit for a 50k-row import. */
const SUBSCRIBER_CHUNK_SIZE = 1000;

/**
 * Refuses a Soko Bot's batch outside its bounds before anything is written or
 * emailed. A batch within them is one chunk, so one receipt covers it.
 */
function requireBotBatch(
  write: NewsletterSubscriberWrite | undefined,
  people: number,
  adding: number,
  nobody: string,
) {
  if (!write) return;
  const max = Math.min(write.maxPeople, SUBSCRIBER_CHUNK_SIZE);
  if (people > max)
    throw unprocessableEntity(
      `This adds ${people} people; at most ${max} can be added at a time here. Add more from the Newsletter's Subscribers page.`,
    );
  if (!adding) throw unprocessableEntity(nobody);
}

interface SubscriberTotals {
  added: number;
  alreadySubscribed: number;
  skippedUnsubscribed: number;
  skippedBounced: number;
  pendingConfirmation: number;
}

function subscriberTotals(chunk: SubscriberChunk): SubscriberTotals {
  return {
    added: chunk.created.length,
    alreadySubscribed: chunk.alreadySubscribed,
    skippedUnsubscribed: chunk.skippedUnsubscribed,
    skippedBounced: chunk.skippedBounced,
    pendingConfirmation: chunk.pendingConfirmation,
  };
}

/** Runs first and last in a chunk's transaction. */
interface ChunkWrite<T> {
  authorize(tx: Prisma.TransactionClient): Promise<unknown>;
  commit(tx: Prisma.TransactionClient, result: T): Promise<unknown>;
}

async function createSubscriberChunks(
  newsletter: Newsletter,
  subscribers: { email: string; name?: string | null }[],
  consent: NewsletterConsent,
  source: NewsletterSubscriberSource,
  actor: ContactActor,
  write?: ChunkWrite<SubscriberTotals>,
) {
  // requireBotBatch kept a bot's batch to one chunk.
  if (write)
    return subscriberTotals(
      await createSubscriberChunk(
        newsletter,
        subscribers,
        consent,
        source,
        actor,
        {
          authorize: write.authorize,
          commit: (tx, chunk) => write.commit(tx, subscriberTotals(chunk)),
        },
      ),
    );
  const result: SubscriberTotals = {
    added: 0,
    alreadySubscribed: 0,
    skippedUnsubscribed: 0,
    skippedBounced: 0,
    pendingConfirmation: 0,
  };
  for (
    let offset = 0;
    offset < subscribers.length;
    offset += SUBSCRIBER_CHUNK_SIZE
  ) {
    const chunk = subscriberTotals(
      await createSubscriberChunk(
        newsletter,
        subscribers.slice(offset, offset + SUBSCRIBER_CHUNK_SIZE),
        consent,
        source,
        actor,
      ),
    );
    for (const key of Object.keys(result) as (keyof SubscriberTotals)[])
      result[key] += chunk[key];
  }
  return result;
}

interface SubscriberChunk {
  contacts: Awaited<ReturnType<typeof linkNewsletterContacts>>;
  created: NewsletterSubscriber[];
  alreadySubscribed: number;
  skippedUnsubscribed: number;
  skippedBounced: number;
  pendingConfirmation: number;
}

async function createSubscriberChunk(
  newsletter: Newsletter,
  subscribers: { email: string; name?: string | null }[],
  consent: NewsletterConsent,
  source: NewsletterSubscriberSource,
  actor: ContactActor,
  write?: ChunkWrite<SubscriberChunk>,
): Promise<SubscriberChunk> {
  const consentAt = new Date();
  // Confirmation emails go out only after this commits.
  const result = await inContactTransaction(async (tx) => {
    await write?.authorize(tx);
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
    // An opt-out belongs to the person, so another of their emails must not re-add them.
    const people = [...new Set([...contacts.values()].map(({ id }) => id))];
    const suppressedPeople = new Map<string, "UNSUBSCRIBED" | "BOUNCED">();
    for (const subscriber of await tx.newsletterSubscriber.findMany({
      where: {
        newsletterId: newsletter.id,
        status: { in: ["UNSUBSCRIBED", "BOUNCED"] },
        contact: {
          OR: [{ id: { in: people } }, { mergedIntoId: { in: people } }],
        },
      },
      select: {
        status: true,
        contact: { select: { id: true, mergedIntoId: true } },
      },
    })) {
      const person = subscriber.contact?.mergedIntoId ?? subscriber.contact?.id;
      if (
        person &&
        (subscriber.status === "UNSUBSCRIBED" ||
          subscriber.status === "BOUNCED")
      )
        suppressedPeople.set(person, subscriber.status);
    }
    const suppressed = subscribers.map((subscriber) => {
      const contact = contacts.get(subscriber.email);
      return contact ? suppressedPeople.get(contact.id) : undefined;
    });
    const candidates = subscribers.filter((_, index) => !suppressed[index]);
    const created = await tx.newsletterSubscriber.createManyAndReturn({
      data: candidates.map((subscriber) => {
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
      created.length < candidates.length
        ? await tx.newsletterSubscriber.findMany({
            where: {
              newsletterId: newsletter.id,
              email: { in: candidates.map((subscriber) => subscriber.email) },
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
    const skipped = [
      ...existing.map((subscriber) => subscriber.status),
      ...suppressed,
    ];
    const chunk: SubscriberChunk = {
      contacts,
      created,
      alreadySubscribed: existing.filter(
        (subscriber) =>
          subscriber.status === "ACTIVE" || subscriber.status === "PENDING",
      ).length,
      skippedUnsubscribed: skipped.filter((status) => status === "UNSUBSCRIBED")
        .length,
      skippedBounced: skipped.filter((status) => status === "BOUNCED").length,
      pendingConfirmation: consent === "ASK" ? created.length : 0,
    };
    await write?.commit(tx, chunk);
    return chunk;
  });
  if (consent === "ASK")
    await sendNewsletterConfirmations(
      newsletter,
      result.created.map((subscriber) => ({ ...subscriber, consentAt })),
    );
  return result;
}
