import type { Prisma } from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";
import {
  CONTACT_CHANNEL_TYPES,
  type CONTACT_SORT_FIELDS,
  CORE_API_ERROR_KINDS,
  type ContactChannelType,
  type ContactFilter,
  type contactChannelInputSchema,
  type contactFieldsSchema,
  contactFilterSchema,
  type contactInteractionInputSchema,
  contactNameFromChannel,
  type createContactSchema,
  normalizeContactChannelValue,
  type updateContactSchema,
} from "@sokosumi/utils";
import type { z } from "zod";
import { resolveTableActor } from "@/helpers/data-table";
import { conflict, notFound, unprocessableEntity } from "@/helpers/error";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import { literalSubstringPattern } from "@/helpers/project-activity";
import { FREEMAIL_DOMAINS } from "@/lib/contacts/capture-filters";
import { isNonPersonName } from "@/lib/contacts/classify";
import { contactReplyState, replyStateWhere } from "@/lib/contacts/reply-state";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import type { AuthenticationContext } from "@/middleware/auth";
import type {
  contactActivitySchema,
  contactDetailSchema,
  contactInteractionSchema,
  contactKnownBySchema,
  contactMergeSuggestionSchema,
  contactSchema,
} from "@/schemas/contact.schema";
import {
  type ContactScoreDto,
  readerScores,
  refreshContactFamiliarity,
  setContactImportance,
} from "@/services/contact-scores.service";

type Tx = Prisma.TransactionClient;
type ContactDto = z.input<typeof contactSchema>;
type ContactDetailDto = z.input<typeof contactDetailSchema>;
type InteractionDto = z.input<typeof contactInteractionSchema>;
type ActivityDto = z.input<typeof contactActivitySchema>;
type KnownByDto = z.input<typeof contactKnownBySchema>;
export type ContactMergeSuggestion = z.input<
  typeof contactMergeSuggestionSchema
>;
type ChannelInput = z.infer<typeof contactChannelInputSchema>;
type FieldsInput = Partial<z.infer<typeof contactFieldsSchema>>;
type CreateContactInput = z.infer<typeof createContactSchema>;
type UpdateContactInput = z.infer<typeof updateContactSchema>;
type InteractionInput = z.infer<typeof contactInteractionInputSchema>;

/** Who reads or writes contacts: a member, or a Soko Bot acting for one. */
export interface ContactActor {
  workspaceId: string;
  userId: string;
  sokoBotId: string | null;
}

/** Membership of the workspace is the only gate: contacts are shared. */
export async function resolveContactActor(
  auth: AuthenticationContext,
  workspaceId: string,
): Promise<ContactActor> {
  const actor = await resolveTableActor(auth, workspaceId);
  return {
    workspaceId,
    userId: actor.userId,
    sokoBotId: actor.actorKind === "sokoBot" ? actor.actorId : null,
  };
}

const CONCURRENT_CHANGE = "Contacts changed at the same time. Try again.";

/**
 * Runs a contact change serializably. A unique key another writer took first
 * (the same channel added twice at once) is the same retryable 409.
 */
export async function inContactTransaction<T>(
  callback: (tx: Tx) => Promise<T>,
): Promise<T> {
  try {
    return await serializableTransaction(callback, CONCURRENT_CHANGE);
  } catch (error) {
    if (isPrismaUniqueViolation(error))
      throw conflict(CONCURRENT_CHANGE, {
        kind: CORE_API_ERROR_KINDS.CONCURRENCY_CONFLICT,
      });
    throw error;
  }
}

const CONTACT_INCLUDE = {
  channels: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
  listMemberships: {
    select: {
      addedAutomatically: true,
      list: { select: { id: true, name: true, color: true } },
    },
    orderBy: { addedAt: "asc" },
  },
} satisfies Prisma.ContactInclude;

type ContactRow = Prisma.ContactGetPayload<{ include: typeof CONTACT_INCLUDE }>;

/** Fields a contact can have filled in; `name` is never empty. */
const FILLABLE_FIELDS = [
  "organization",
  "role",
  "location",
  "summary",
  "whyInteresting",
  "nextStep",
  "followUpAt",
  "avatarUrl",
] as const;

function isoDate(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function dateFromIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}

function toInputJson(value: Record<string, unknown>): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value));
}

function toContactDto(
  row: ContactRow,
  knownBy: KnownByDto[],
  score: ContactScoreDto | null,
): ContactDto {
  return {
    score,
    id: row.id,
    name: row.name,
    organization: row.organization,
    role: row.role,
    location: row.location,
    summary: row.summary,
    whyInteresting: row.whyInteresting,
    stage: row.stage,
    kind: row.kind,
    nextStep: row.nextStep,
    followUpAt: isoDate(row.followUpAt),
    avatarUrl: row.avatarUrl,
    customFields: jsonObject(row.customFields),
    firstContactAt: row.firstContactAt,
    lastContactAt: row.lastContactAt,
    interactionCount: row.interactionCount,
    lastInboundAt: row.lastInboundAt,
    awaitingReplySince: row.awaitingReplySince,
    replyState: contactReplyState(row),
    createdByUserId: row.createdByUserId,
    createdBySokoBotId: row.createdBySokoBotId,
    mergedIntoId: row.mergedIntoId,
    version: row.version,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    channels: row.channels.map((channel) => ({
      id: channel.id,
      type: channel.type,
      value: channel.value,
      label: channel.label,
      isPrimary: channel.isPrimary,
      source: channel.source,
      sourceUrl: channel.sourceUrl,
      verified: channel.verified,
      createdAt: channel.createdAt,
    })),
    lists: row.listMemberships.map((membership) => ({
      ...membership.list,
      color: listColor(membership.list.color),
      addedAutomatically: membership.addedAutomatically,
    })),
    knownBy,
  };
}

function listColor(value: string) {
  return value as ContactDto["lists"][number]["color"];
}

/** Teammates who had interactions with each contact, most recent first. */
async function knownByFor(
  contactIds: string[],
  tx: Tx = prisma,
): Promise<Map<string, KnownByDto[]>> {
  const result = new Map<string, KnownByDto[]>();
  if (!contactIds.length) return result;
  const groups = await tx.contactInteraction.groupBy({
    by: ["contactId", "userId"],
    where: { contactId: { in: contactIds }, userId: { not: null } },
    _count: { _all: true },
    _max: { occurredAt: true },
  });
  const userIds = [
    ...new Set(groups.flatMap((group) => (group.userId ? [group.userId] : []))),
  ];
  const users = new Map(
    (
      await tx.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, image: true },
      })
    ).map((user) => [user.id, user]),
  );
  const recentFirst = [...groups].sort(
    (a, b) =>
      (b._max.occurredAt?.getTime() ?? 0) - (a._max.occurredAt?.getTime() ?? 0),
  );
  for (const group of recentFirst) {
    const user = group.userId ? users.get(group.userId) : undefined;
    if (!user) continue;
    const entries = result.get(group.contactId) ?? [];
    entries.push({
      ...user,
      interactionCount: group._count._all,
      lastInteractionAt: group._max.occurredAt,
    });
    result.set(group.contactId, entries);
  }
  return result;
}

/** `readerUserId` adds that teammate's own scores; without one, none. */
export async function contactDtos(
  rows: ContactRow[],
  tx: Tx = prisma,
  readerUserId?: string,
): Promise<ContactDto[]> {
  const ids = rows.map((row) => row.id);
  const [knownBy, scores] = await Promise.all([
    knownByFor(ids, tx),
    readerUserId ? readerScores(tx, readerUserId, ids) : null,
  ]);
  return rows.map((row) =>
    toContactDto(row, knownBy.get(row.id) ?? [], scores?.get(row.id) ?? null),
  );
}

async function loadContactDto(
  tx: Tx,
  id: string,
  readerUserId?: string,
): Promise<ContactDto> {
  const row = await tx.contact.findUniqueOrThrow({
    where: { id },
    include: CONTACT_INCLUDE,
  });
  const [dto] = await contactDtos([row], tx, readerUserId);
  if (!dto) throw notFound("Contact not found");
  return dto;
}

async function requireContactRow(tx: Tx, actor: ContactActor, id: string) {
  const contact = await tx.contact.findFirst({
    where: { id, workspaceId: actor.workspaceId },
  });
  if (!contact) throw notFound("Contact not found");
  return contact;
}

/** A live (not merged) contact in the actor's workspace, for a change. */
async function requireWritableContact(tx: Tx, actor: ContactActor, id: string) {
  const contact = await requireContactRow(tx, actor, id);
  if (contact.mergedIntoId)
    throw conflict("This contact was merged into another contact", {
      extensions: { mergedIntoId: contact.mergedIntoId },
    });
  return contact;
}

async function recordActivity(
  tx: Tx,
  actor: ContactActor,
  contactId: string,
  kind: Prisma.ContactActivityCreateManyInput["kind"],
  changes: Record<string, unknown> = {},
) {
  await tx.contactActivity.create({
    data: {
      workspaceId: actor.workspaceId,
      contactId,
      userId: actor.userId,
      sokoBotId: actor.sokoBotId,
      kind,
      changes: toInputJson(changes),
    },
  });
}

export interface NormalizedChannel {
  type: ContactChannelType;
  value: string;
  label: string | null;
  isPrimary: boolean | undefined;
  source: ChannelInput["source"];
  sourceUrl: string | null;
  verified: boolean;
}

/** Normalized and de-duplicated; an unusable address is a 422. */
export function normalizeChannels(
  channels: readonly ChannelInput[],
): NormalizedChannel[] {
  const seen = new Set<string>();
  const result: NormalizedChannel[] = [];
  for (const channel of channels) {
    const value = normalizeContactChannelValue(channel.type, channel.value);
    if (!value)
      throw unprocessableEntity(
        `"${channel.value}" is not a valid ${channel.type.toLowerCase()} channel`,
      );
    const key = `${channel.type}:${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      type: channel.type,
      value,
      label: channel.label ?? null,
      isPrimary: channel.isPrimary,
      source: channel.source,
      sourceUrl: channel.sourceUrl ?? null,
      verified: channel.verified ?? false,
    });
  }
  return result;
}

/** Stored form of contact fields; valid for both create and update. */
interface ContactFieldData {
  name?: string;
  organization?: string | null;
  role?: string | null;
  location?: string | null;
  summary?: string | null;
  whyInteresting?: string | null;
  nextStep?: string | null;
  followUpAt?: Date | null;
  avatarUrl?: string | null;
  stage?: z.infer<typeof contactFieldsSchema>["stage"];
  kind?: z.infer<typeof contactFieldsSchema>["kind"];
  customFields?: Prisma.InputJsonObject;
}

/** Stored form of the editable fields that were given. */
function fieldData(input: FieldsInput): ContactFieldData {
  const data: ContactFieldData = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.stage !== undefined) data.stage = input.stage;
  if (input.kind !== undefined) data.kind = input.kind;
  for (const field of FILLABLE_FIELDS) {
    const value = input[field];
    if (value === undefined || field === "followUpAt") continue;
    data[field] = value;
  }
  if (input.followUpAt !== undefined)
    data.followUpAt = input.followUpAt
      ? dateFromIsoDate(input.followUpAt)
      : null;
  if (input.customFields !== undefined)
    data.customFields = toInputJson(input.customFields);
  return data;
}

function comparable(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object") return JSON.stringify(value);
  return value ?? null;
}

/** `{ field: { before, after } }` for the fields an update really changes. */
function changedFields(
  before: Record<string, unknown>,
  data: ContactFieldData,
) {
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  for (const [field, after] of Object.entries(data)) {
    const previous = before[field];
    if (comparable(previous) === comparable(after)) continue;
    changes[field] = {
      before: comparable(previous),
      after: comparable(after),
    };
  }
  return changes;
}

async function createChannels(
  tx: Tx,
  actor: ContactActor,
  contactId: string,
  channels: NormalizedChannel[],
  defaultSource: ChannelInput["source"],
) {
  if (!channels.length) return;
  const existing = await tx.contactChannel.findMany({
    where: { contactId, isPrimary: true },
    select: { type: true },
  });
  const primaryTypes = new Set(existing.map((channel) => channel.type));
  for (const channel of channels) {
    const isPrimary = channel.isPrimary ?? !primaryTypes.has(channel.type);
    if (isPrimary && primaryTypes.has(channel.type))
      await tx.contactChannel.updateMany({
        where: { contactId, type: channel.type, isPrimary: true },
        data: { isPrimary: false },
      });
    if (isPrimary) primaryTypes.add(channel.type);
    await tx.contactChannel.create({
      data: {
        workspaceId: actor.workspaceId,
        contactId,
        type: channel.type,
        value: channel.value,
        label: channel.label,
        isPrimary,
        source: channel.source ?? defaultSource ?? "MANUAL",
        sourceUrl: channel.sourceUrl,
        verified: channel.verified,
      },
    });
  }
}

function channelTakenError(existingContactId: string, value: string) {
  return conflict(`${value} already belongs to another contact`, {
    kind: CORE_API_ERROR_KINDS.CONTACT_CHANNEL_TAKEN,
    extensions: { existingContactId },
  });
}

/** What `input` adds to `contact`'s empty fields, never overwriting. */
function fillEmpty(
  contact: Record<string, unknown>,
  input: ContactFieldData,
): ContactFieldData {
  const fill: ContactFieldData = {};
  for (const field of FILLABLE_FIELDS) {
    const value = input[field];
    if (value != null && contact[field] == null)
      Object.assign(fill, { [field]: value });
  }
  if (input.customFields) {
    const current = jsonObject(contact.customFields);
    const missing = Object.entries(input.customFields).filter(
      ([key]) => !(key in current),
    );
    if (missing.length)
      fill.customFields = toInputJson({
        ...current,
        ...Object.fromEntries(missing),
      });
  }
  return fill;
}

export interface UpsertContactResult {
  contact: ContactDto;
  created: boolean;
  /** Whether anything was written: created, filled or given a channel. */
  changed: boolean;
  mergeSuggestion: ContactMergeSuggestion | null;
}

/**
 * Creates a contact, or — with `upsert` — fills the contact that already owns
 * one of its channels: missing channels are attached and empty fields filled,
 * nothing set is overwritten. When the channels belong to two different
 * contacts, the first one is used and the pair comes back as a merge
 * suggestion. Without `upsert`, a taken channel is a 409 naming its contact.
 */
export async function upsertContact(
  tx: Tx,
  actor: ContactActor,
  input: CreateContactInput,
  options: { defaultChannelSource?: ChannelInput["source"] } = {},
): Promise<UpsertContactResult> {
  const channels = normalizeChannels(input.channels);
  const taken = channels.length
    ? await tx.contactChannel.findMany({
        where: {
          workspaceId: actor.workspaceId,
          OR: channels.map(({ type, value }) => ({ type, value })),
        },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const ownerIds = [...new Set(taken.map((channel) => channel.contactId))];
  const [targetId] = ownerIds;
  if (!targetId) {
    const first = channels[0];
    const name =
      input.name ??
      (first ? contactNameFromChannel(first.type, first.value) : "");
    const contact = await tx.contact.create({
      data: {
        ...fieldData(input),
        name,
        workspaceId: actor.workspaceId,
        createdByUserId: actor.userId,
        createdBySokoBotId: actor.sokoBotId,
      },
    });
    await createChannels(
      tx,
      actor,
      contact.id,
      channels,
      options.defaultChannelSource,
    );
    await recordActivity(tx, actor, contact.id, "CREATED", {
      channels: channels.map(({ type, value }) => `${type}:${value}`),
    });
    return {
      contact: await loadContactDto(tx, contact.id, actor.userId),
      created: true,
      changed: true,
      mergeSuggestion: null,
    };
  }
  const existing = taken.find((channel) => channel.contactId === targetId);
  if (!input.upsert)
    throw channelTakenError(targetId, existing?.value ?? "This channel");

  const contact = await tx.contact.findUniqueOrThrow({
    where: { id: targetId },
  });
  const takenKeys = new Set(taken.map(({ type, value }) => `${type}:${value}`));
  const added = channels.filter(
    ({ type, value }) => !takenKeys.has(`${type}:${value}`),
  );
  await createChannels(
    tx,
    actor,
    contact.id,
    added,
    options.defaultChannelSource,
  );
  const data = fillEmpty(contact, fieldData(input));
  const changes = changedFields(contact, data);
  const changed = Object.keys(changes).length > 0 || added.length > 0;
  if (changed) {
    await tx.contact.update({
      where: { id: contact.id },
      data: { ...data, version: { increment: 1 } },
    });
    if (Object.keys(changes).length)
      await recordActivity(tx, actor, contact.id, "UPDATED", changes);
    if (added.length)
      await recordActivity(tx, actor, contact.id, "CHANNEL_ADDED", {
        channels: added.map(({ type, value }) => `${type}:${value}`),
      });
  }
  return {
    contact: await loadContactDto(tx, contact.id, actor.userId),
    created: false,
    changed,
    mergeSuggestion:
      ownerIds.length > 1
        ? { reason: "shared_channel", contactIds: ownerIds }
        : null,
  };
}

function versionConflict() {
  return conflict("This contact changed. Reload it and try again.", {
    kind: CORE_API_ERROR_KINDS.CONTACT_VERSION_CONFLICT,
  });
}

/** Changes the given fields when `version` is still current. */
export async function updateContact(
  tx: Tx,
  actor: ContactActor,
  id: string,
  input: UpdateContactInput,
): Promise<ContactDto> {
  const contact = await requireWritableContact(tx, actor, id);
  if (contact.version !== input.version) throw versionConflict();
  const data = fieldData(input);
  const changes = changedFields(contact, data);
  if (!Object.keys(changes).length) return loadContactDto(tx, id, actor.userId);
  const updated = await tx.contact.updateMany({
    where: { id, version: input.version },
    data: { ...data, version: { increment: 1 } },
  });
  if (updated.count !== 1) throw versionConflict();
  await recordActivity(tx, actor, id, "UPDATED", changes);
  return loadContactDto(tx, id, actor.userId);
}

export async function setContactArchived(
  tx: Tx,
  actor: ContactActor,
  id: string,
  archived: boolean,
): Promise<ContactDto> {
  const contact = await requireWritableContact(tx, actor, id);
  if (Boolean(contact.archivedAt) !== archived) {
    await tx.contact.update({
      where: { id },
      data: {
        archivedAt: archived ? new Date() : null,
        version: { increment: 1 },
      },
    });
    await recordActivity(tx, actor, id, archived ? "ARCHIVED" : "UNARCHIVED");
  }
  return loadContactDto(tx, id, actor.userId);
}

/** Adds one channel; a channel the contact already has is returned as is. */
export async function addContactChannel(
  tx: Tx,
  actor: ContactActor,
  contactId: string,
  input: ChannelInput,
): Promise<ContactDto> {
  await requireWritableContact(tx, actor, contactId);
  const [channel] = normalizeChannels([input]);
  if (!channel) throw unprocessableEntity("Channel is required");
  const existing = await tx.contactChannel.findUnique({
    where: {
      workspaceId_type_value: {
        workspaceId: actor.workspaceId,
        type: channel.type,
        value: channel.value,
      },
    },
  });
  if (existing && existing.contactId !== contactId)
    throw channelTakenError(existing.contactId, channel.value);
  if (!existing) {
    await createChannels(tx, actor, contactId, [channel], undefined);
    await tx.contact.update({
      where: { id: contactId },
      data: { version: { increment: 1 } },
    });
    await recordActivity(tx, actor, contactId, "CHANNEL_ADDED", {
      channels: [`${channel.type}:${channel.value}`],
    });
  }
  return loadContactDto(tx, contactId, actor.userId);
}

export async function removeContactChannel(
  tx: Tx,
  actor: ContactActor,
  contactId: string,
  channelId: string,
): Promise<ContactDto> {
  await requireWritableContact(tx, actor, contactId);
  const channel = await tx.contactChannel.findFirst({
    where: { id: channelId, contactId },
  });
  if (!channel) throw notFound("Channel not found");
  await tx.contactChannel.delete({ where: { id: channelId } });
  if (channel.isPrimary) {
    const next = await tx.contactChannel.findFirst({
      where: { contactId, type: channel.type },
      orderBy: { createdAt: "asc" },
    });
    if (next)
      await tx.contactChannel.update({
        where: { id: next.id },
        data: { isPrimary: true },
      });
  }
  await tx.contact.update({
    where: { id: contactId },
    data: { version: { increment: 1 } },
  });
  await recordActivity(tx, actor, contactId, "CHANNEL_REMOVED", {
    channels: [`${channel.type}:${channel.value}`],
  });
  return loadContactDto(tx, contactId, actor.userId);
}

/**
 * First and last contact, the count and the reply fields always follow the
 * interactions. A meeting (BOTH) counts as hearing from them; undirected
 * notes say nothing about who is waiting.
 */
async function refreshDerivedFields(tx: Tx, contactId: string) {
  await refreshContactFamiliarity(tx, { contactId });
  const [aggregate, inbound] = await Promise.all([
    tx.contactInteraction.aggregate({
      where: { contactId },
      _min: { occurredAt: true },
      _max: { occurredAt: true },
      _count: { _all: true },
    }),
    tx.contactInteraction.aggregate({
      where: { contactId, direction: { in: ["IN", "BOTH"] } },
      _max: { occurredAt: true },
    }),
  ]);
  const lastInboundAt = inbound._max.occurredAt;
  const waiting = await tx.contactInteraction.aggregate({
    where: {
      contactId,
      direction: "OUT",
      ...(lastInboundAt ? { occurredAt: { gt: lastInboundAt } } : {}),
    },
    _min: { occurredAt: true },
  });
  await tx.contact.update({
    where: { id: contactId },
    data: {
      firstContactAt: aggregate._min.occurredAt,
      lastContactAt: aggregate._max.occurredAt,
      interactionCount: aggregate._count._all,
      lastInboundAt,
      awaitingReplySince: waiting._min.occurredAt,
    },
  });
}

const INTERACTION_INCLUDE = {
  user: { select: { id: true, name: true, image: true } },
  sokoBot: { select: { id: true, name: true } },
} satisfies Prisma.ContactInteractionInclude;

function toInteractionDto(
  row: Prisma.ContactInteractionGetPayload<{
    include: typeof INTERACTION_INCLUDE;
  }>,
): InteractionDto {
  return {
    id: row.id,
    contactId: row.contactId,
    occurredAt: row.occurredAt,
    channel: row.channel,
    direction: row.direction,
    summary: row.summary,
    sourceRef: row.sourceRef,
    sourceUrl: row.sourceUrl,
    user: row.user,
    sokoBot: row.sokoBot,
    createdAt: row.createdAt,
  };
}

/**
 * Records an interaction and refreshes the contact's derived fields in the
 * same transaction. A `sourceRef` already recorded returns that interaction.
 * `userId` is the teammate who had it; it defaults to the actor.
 */
export async function logContactInteraction(
  tx: Tx,
  actor: ContactActor,
  contactId: string,
  input: InteractionInput,
  options: { userId?: string } = {},
): Promise<{ interaction: InteractionDto; created: boolean }> {
  await requireWritableContact(tx, actor, contactId);
  if (input.sourceRef) {
    const existing = await tx.contactInteraction.findUnique({
      where: {
        workspaceId_channel_sourceRef: {
          workspaceId: actor.workspaceId,
          channel: input.channel,
          sourceRef: input.sourceRef,
        },
      },
      include: INTERACTION_INCLUDE,
    });
    if (existing)
      return { interaction: toInteractionDto(existing), created: false };
  }
  const interaction = await tx.contactInteraction.create({
    data: {
      workspaceId: actor.workspaceId,
      contactId,
      userId: options.userId ?? actor.userId,
      sokoBotId: actor.sokoBotId,
      occurredAt: new Date(input.occurredAt),
      channel: input.channel,
      direction: input.direction ?? null,
      summary: input.summary,
      sourceRef: input.sourceRef ?? null,
      sourceUrl: input.sourceUrl ?? null,
    },
    include: INTERACTION_INCLUDE,
  });
  await refreshDerivedFields(tx, contactId);
  return { interaction: toInteractionDto(interaction), created: true };
}

export async function removeContactInteraction(
  tx: Tx,
  actor: ContactActor,
  contactId: string,
  interactionId: string,
): Promise<ContactDto> {
  await requireWritableContact(tx, actor, contactId);
  const removed = await tx.contactInteraction.deleteMany({
    where: { id: interactionId, contactId },
  });
  if (!removed.count) throw notFound("Interaction not found");
  await refreshDerivedFields(tx, contactId);
  return loadContactDto(tx, contactId, actor.userId);
}

/**
 * Folds `loserIds` into `winnerId`: channels, interactions, list memberships
 * and history move to the winner, the winner's empty fields are filled from
 * the losers in the given order, and each loser stays as a tombstone that
 * points at the winner. Run it in one serializable transaction.
 */
export async function mergeContacts(
  tx: Tx,
  actor: ContactActor,
  winnerId: string,
  loserIds: string[],
): Promise<ContactDto> {
  const ids = [winnerId, ...new Set(loserIds)].filter(
    (id, index, all) => all.indexOf(id) === index,
  );
  const contacts = await tx.contact.findMany({
    where: { id: { in: ids }, workspaceId: actor.workspaceId },
  });
  const byId = new Map(contacts.map((contact) => [contact.id, contact]));
  const winner = byId.get(winnerId);
  const losers = ids.slice(1).map((id) => byId.get(id));
  if (!winner || losers.some((loser) => !loser))
    throw notFound("Contact not found");
  const live = losers.filter((loser) => loser !== undefined);
  if ([winner, ...live].some((contact) => contact.mergedIntoId))
    throw conflict("A merged contact cannot be merged again");
  const loserIdList = live.map((loser) => loser.id);

  const winnerPrimary = await tx.contactChannel.findMany({
    where: { contactId: winnerId, isPrimary: true },
    select: { type: true },
  });
  await tx.contactChannel.updateMany({
    where: {
      contactId: { in: loserIdList },
      type: { in: winnerPrimary.map((channel) => channel.type) },
    },
    data: { isPrimary: false },
  });
  const movedChannels = await tx.contactChannel.updateMany({
    where: { contactId: { in: loserIdList } },
    data: { contactId: winnerId },
  });
  // Keep one primary per type when two losers brought the same type.
  const primaries = await tx.contactChannel.findMany({
    where: { contactId: winnerId, isPrimary: true },
    orderBy: { createdAt: "asc" },
  });
  const seenTypes = new Set<string>();
  for (const channel of primaries) {
    if (seenTypes.has(channel.type))
      await tx.contactChannel.update({
        where: { id: channel.id },
        data: { isPrimary: false },
      });
    seenTypes.add(channel.type);
  }
  const movedInteractions = await tx.contactInteraction.updateMany({
    where: { contactId: { in: loserIdList } },
    data: { contactId: winnerId },
  });
  const memberships = await tx.contactListMember.findMany({
    where: { contactId: { in: loserIdList } },
  });
  await tx.contactListMember.createMany({
    data: memberships.map((membership) => ({
      listId: membership.listId,
      contactId: winnerId,
      addedByUserId: membership.addedByUserId,
      addedBySokoBotId: membership.addedBySokoBotId,
      addedAutomatically: membership.addedAutomatically,
      addedAt: membership.addedAt,
    })),
    skipDuplicates: true,
  });
  await tx.contactListMember.deleteMany({
    where: { contactId: { in: loserIdList } },
  });
  await tx.contactActivity.updateMany({
    where: { contactId: { in: loserIdList } },
    data: { contactId: winnerId },
  });
  await tx.contact.updateMany({
    where: { mergedIntoId: { in: loserIdList } },
    data: { mergedIntoId: winnerId },
  });
  const now = new Date();
  await tx.contact.updateMany({
    where: { id: { in: loserIdList } },
    data: {
      mergedIntoId: winnerId,
      archivedAt: now,
      version: { increment: 1 },
    },
  });

  let fill: ContactFieldData = {};
  for (const loser of live) {
    const extra = fillEmpty(
      {
        ...winner,
        ...fill,
        customFields: fill.customFields ?? winner.customFields,
      },
      {
        ...Object.fromEntries(
          FILLABLE_FIELDS.map((field) => [field, loser[field]]),
        ),
        customFields: toInputJson(jsonObject(loser.customFields)),
      },
    );
    fill = { ...fill, ...extra };
  }
  // A winner still on the default takes the first stage someone chose.
  const stage =
    winner.stage === "CONTACT"
      ? live.find((loser) => loser.stage !== "CONTACT")?.stage
      : undefined;
  await tx.contact.update({
    where: { id: winnerId },
    data: { ...fill, ...(stage ? { stage } : {}), version: { increment: 1 } },
  });
  await refreshDerivedFields(tx, winnerId);
  await recordActivity(tx, actor, winnerId, "MERGED", {
    mergedContactIds: loserIdList,
    mergedNames: live.map((loser) => loser.name),
    filledFields: Object.keys(fill),
    movedChannels: movedChannels.count,
    movedInteractions: movedInteractions.count,
  });
  return loadContactDto(tx, winnerId, actor.userId);
}

/** Mail providers whose domain names no company, for the SQL below. */
const PERSONAL_MAIL_DOMAINS = [...FREEMAIL_DOMAINS];

/**
 * Live contacts that may be one person: the same name (case and spacing
 * ignored), or the same surname and first initial with an address at the
 * same company domain ("Tom Berger" tom@acme.com and "Thomas Berger"
 * t.berger@acme.com).
 */
export async function findDuplicateContacts(
  actor: ContactActor,
  options: { contactId?: string; limit?: number } = {},
): Promise<{ name: string; contacts: ContactDto[] }[]> {
  const only = options.contactId
    ? PrismaRaw.sql`AND bool_or(c."id" = ${options.contactId}::uuid)`
    : PrismaRaw.empty;
  const limit = options.limit ?? 50;
  const sameName = await prisma.$queryRaw<{ key: string; ids: string[] }[]>`
    SELECT lower(btrim(c."name")) AS "key", array_agg(c."id"::text ORDER BY c."createdAt") AS "ids"
    FROM "contact" c
    WHERE c."workspaceId" = ${actor.workspaceId}::uuid
      AND c."mergedIntoId" IS NULL
      AND c."archivedAt" IS NULL
    GROUP BY lower(btrim(c."name"))
    HAVING count(*) > 1
      ${only}
    ORDER BY lower(btrim(c."name"))
    LIMIT ${limit}
  `;
  const sameCompany = await prisma.$queryRaw<{ key: string; ids: string[] }[]>`
    SELECT min(c."name") AS "key", array_agg(DISTINCT c."id"::text) AS "ids"
    FROM "contact" c
    JOIN "contact_channel" ch ON ch."contactId" = c."id" AND ch."type" = 'EMAIL'
    WHERE c."workspaceId" = ${actor.workspaceId}::uuid
      AND c."mergedIntoId" IS NULL
      AND c."archivedAt" IS NULL
      AND btrim(c."name") LIKE '% %'
      AND split_part(ch."value", '@', 2) <> ALL(${PERSONAL_MAIL_DOMAINS}::text[])
    GROUP BY split_part(ch."value", '@', 2),
      lower(regexp_replace(btrim(c."name"), '^.*\\s', '')),
      lower(left(btrim(c."name"), 1))
    HAVING count(DISTINCT c."id") > 1
      AND count(DISTINCT lower(btrim(c."name"))) > 1
      ${only}
    LIMIT ${limit}
  `;
  const seen = new Set<string>();
  const groups = [...sameName, ...sameCompany].filter((group) => {
    const key = [...group.ids].sort().join(",");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const ids = [...new Set(groups.flatMap((group) => group.ids))];
  const rows = await prisma.contact.findMany({
    where: { id: { in: ids } },
    include: CONTACT_INCLUDE,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const age = new Map(rows.map((row, index) => [row.id, index]));
  const dtos = new Map(
    (await contactDtos(rows)).map((contact) => [contact.id, contact]),
  );
  return groups.slice(0, limit).map((group) => {
    const contacts = [...group.ids]
      .sort((a, b) => (age.get(a) ?? 0) - (age.get(b) ?? 0))
      .flatMap((id) => {
        const contact = dtos.get(id);
        return contact ? [contact] : [];
      });
    return { name: contacts[0]?.name ?? group.key, contacts };
  });
}

/** The query a contact filter stands for, as seen by `actor`. */
export function contactFilterWhere(
  actor: ContactActor,
  filter: ContactFilter,
  now: Date = new Date(),
): Prisma.ContactWhereInput[] {
  const days = (count: number) => new Date(now.getTime() - count * 86_400_000);
  const and: Prisma.ContactWhereInput[] = [];
  if (filter.search) {
    const search = filter.search;
    and.push({
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { organization: { contains: search, mode: "insensitive" } },
        {
          channels: {
            some: { value: { contains: search, mode: "insensitive" } },
          },
        },
      ],
    });
  }
  if (filter.stages) and.push({ stage: { in: filter.stages } });
  if (filter.kind) and.push({ kind: filter.kind });
  if (filter.replyStates)
    and.push({
      OR: filter.replyStates.map((state) => replyStateWhere(state, now)),
    });
  if (filter.listIds)
    and.push({ listMemberships: { some: { listId: { in: filter.listIds } } } });
  if (filter.knownByUserId)
    and.push({ interactions: { some: { userId: filter.knownByUserId } } });
  if (filter.knownByMe)
    and.push({ interactions: { some: { userId: actor.userId } } });
  if (filter.lastContactAfter)
    and.push({ lastContactAt: { gte: new Date(filter.lastContactAfter) } });
  if (filter.lastContactBefore)
    and.push({ lastContactAt: { lt: new Date(filter.lastContactBefore) } });
  if (filter.lastContactOlderThanDays)
    and.push({ lastContactAt: { lt: days(filter.lastContactOlderThanDays) } });
  if (filter.createdWithinDays)
    and.push({ createdAt: { gte: days(filter.createdWithinDays) } });
  if (filter.followUpDue !== undefined) {
    const today = dateFromIsoDate(now.toISOString().slice(0, 10));
    and.push(
      filter.followUpDue
        ? { followUpAt: { lte: today } }
        : { OR: [{ followUpAt: null }, { followUpAt: { gt: today } }] },
    );
  }
  if (filter.hasChannel)
    and.push({ channels: { some: { type: filter.hasChannel } } });
  if (filter.hasInteractions !== undefined)
    and.push(
      filter.hasInteractions
        ? { interactionCount: { gt: 0 } }
        : { interactionCount: 0 },
    );
  return and;
}

/** A stored smart filter; `null` for a manual list. */
export function parseSmartFilter(
  value: Prisma.JsonValue,
): ContactFilter | null {
  if (value === null) return null;
  return contactFilterSchema.parse(value);
}

type ContactSortField = (typeof CONTACT_SORT_FIELDS)[number];

export interface ListContactsOptions {
  filter: ContactFilter;
  listId?: string;
  /** People at the company this name belongs to, by any spelling. */
  company?: string;
  archived?: boolean;
  sort: ContactSortField;
  direction?: "asc" | "desc";
  cursor?: string;
  limit: number;
}

/** Live contacts matching a filter and, optionally, a manual or smart list. */
export async function contactListWhere(
  actor: ContactActor,
  options: Pick<
    ListContactsOptions,
    "filter" | "listId" | "company" | "archived"
  >,
): Promise<Prisma.ContactWhereInput> {
  const and = contactFilterWhere(actor, options.filter);
  if (options.company)
    and.push({
      id: {
        in: await contactCompanyMemberIds(actor.workspaceId, options.company),
      },
    });
  if (options.listId) {
    const list = await prisma.contactList.findFirst({
      where: { id: options.listId, workspaceId: actor.workspaceId },
    });
    if (!list) throw notFound("List not found");
    const smart = parseSmartFilter(list.smartFilter);
    and.push(
      ...(smart
        ? contactFilterWhere(actor, smart)
        : [{ listMemberships: { some: { listId: list.id } } }]),
    );
  }
  return {
    workspaceId: actor.workspaceId,
    mergedIntoId: null,
    archivedAt: options.archived ? { not: null } : null,
    AND: and,
  };
}

function contactOrderBy(
  sort: ContactSortField,
  direction: "asc" | "desc" | undefined,
): Prisma.ContactOrderByWithRelationInput[] {
  const dir =
    direction ??
    (sort === "name" || sort === "organization" || sort === "stage"
      ? "asc"
      : "desc");
  const nullable = sort === "organization" || sort.endsWith("ContactAt");
  if (sort === "familiarity" || sort === "importance")
    throw new Error("Score sorts are ordered by listContactsByScore");
  return [
    nullable ? { [sort]: { sort: dir, nulls: "last" } } : { [sort]: dir },
    { id: dir },
  ];
}

export async function listContacts(
  actor: ContactActor,
  options: ListContactsOptions,
): Promise<{ items: ContactDto[]; total: number; nextCursor: string | null }> {
  const where = await contactListWhere(actor, options);
  if (options.sort === "familiarity" || options.sort === "importance")
    return listContactsByScore(actor, options, where);
  const [rows, total] = await prisma.$transaction([
    prisma.contact.findMany({
      where,
      include: CONTACT_INCLUDE,
      orderBy: contactOrderBy(options.sort, options.direction),
      take: options.limit + 1,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    }),
    prisma.contact.count({ where }),
  ]);
  const page = rows.slice(0, options.limit);
  return {
    items: await contactDtos(page, prisma, actor.userId),
    total,
    nextCursor: rows.length > options.limit ? (page.at(-1)?.id ?? null) : null,
  };
}

/**
 * A page ordered by the reader's own score, which lives per teammate in
 * `contact_score` and so cannot be a Prisma order. Matching ids come first,
 * then SQL orders them; the cursor is the last contact id, as elsewhere.
 * Contacts the reader never scored come last.
 */
async function listContactsByScore(
  actor: ContactActor,
  options: ListContactsOptions,
  where: Prisma.ContactWhereInput,
): Promise<{ items: ContactDto[]; total: number; nextCursor: string | null }> {
  const ids = (
    await prisma.contact.findMany({ where, select: { id: true } })
  ).map((row) => row.id);
  const column =
    options.sort === "importance"
      ? PrismaRaw.sql`s.importance`
      : PrismaRaw.sql`s.familiarity`;
  const direction =
    options.direction === "asc" ? PrismaRaw.sql`ASC` : PrismaRaw.sql`DESC`;
  const ordered = await prisma.$queryRaw<{ id: string }[]>`
    SELECT c.id FROM unnest(${ids}::uuid[]) AS c(id)
    LEFT JOIN contact_score s
      ON s."contactId" = c.id AND s."userId" = ${actor.userId}
    ORDER BY ${column} ${direction} NULLS LAST, c.id ${direction}
  `;
  const start = options.cursor
    ? ordered.findIndex((row) => row.id === options.cursor) + 1
    : 0;
  const pageIds = ordered
    .slice(start, start + options.limit)
    .map((row) => row.id);
  const rows = await prisma.contact.findMany({
    where: { id: { in: pageIds } },
    include: CONTACT_INCLUDE,
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return {
    items: await contactDtos(
      pageIds.flatMap((id) => byId.get(id) ?? []),
      prisma,
      actor.userId,
    ),
    total: ids.length,
    nextCursor:
      start + options.limit < ordered.length ? (pageIds.at(-1) ?? null) : null,
  };
}

/**
 * Free mail and internet-provider domains. Many unrelated people share them,
 * so an address there says nothing about where someone works.
 */
const SHARED_MAIL_DOMAIN =
  "^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|icloud|me|mac|gmx|web|t-online|bluewin|aon|chello|hin|proton|protonmail|pm|aol|mail|yandex|freenet|posteo|mailbox|arcor|vodafone|online|a1|sunrise|orange|free|wanadoo|libero|tiscali|seznam|wp|o2|qq|163|naver)\\.";

/**
 * Which company each live contact of a workspace belongs to, as a CTE ending
 * in `assigned (id, raw, org, key, cluster_org)`.
 *
 * People write one company many ways ("House of Communication", "House of
 * Communications", "House of Communication / Serviceplan Group"), so the name
 * alone splits it. An email domain is the stronger signal: a domain whose
 * named people mostly use one name, or names that contain it ("Acme",
 * "Acme Ltd"), is that company, and its people join it when their own name is
 * empty or resembles that one. Domains whose people
 * use the same name are one company. Names compare as lowercase letters and
 * digits only. Everyone else is grouped by name.
 */
function contactCompaniesCte(workspaceId: string) {
  return PrismaRaw.sql`
    WITH live AS (
      SELECT c.id, c.organization AS raw,
        nullif(regexp_replace(lower(coalesce(c.organization, '')), '[^[:alnum:]]+', '', 'g'), '') AS org
      FROM contact c
      WHERE c."workspaceId" = ${workspaceId}::uuid
        AND c."mergedIntoId" IS NULL AND c."archivedAt" IS NULL
    ), domains AS (
      SELECT DISTINCT l.id, lower(split_part(ch.value, '@', 2)) AS domain
      FROM live l
      JOIN contact_channel ch ON ch."contactId" = l.id AND ch.type = 'EMAIL'
      WHERE lower(split_part(ch.value, '@', 2)) !~ ${SHARED_MAIL_DOMAIN}
    ), domain_names AS (
      SELECT d.domain, l.org, count(*) AS n
      FROM domains d JOIN live l USING (id)
      WHERE l.org IS NOT NULL
      GROUP BY 1, 2
    ), top_names AS (
      SELECT DISTINCT ON (domain) domain, org
      FROM domain_names
      ORDER BY domain, n DESC, length(org), org
    ), company_domains AS (
      SELECT t.domain, t.org
      FROM top_names t JOIN domain_names dn ON dn.domain = t.domain
      GROUP BY t.domain, t.org
      HAVING 2 * coalesce(sum(dn.n) FILTER (
        WHERE position(t.org IN dn.org) > 0 OR position(dn.org IN t.org) > 0
      ), 0) > sum(dn.n)
    ), canonical AS (
      SELECT domain, org, min(domain) OVER (PARTITION BY org) AS canonical
      FROM company_domains
    ), by_email AS (
      SELECT DISTINCT ON (d.id) d.id, cd.canonical AS domain, cd.org
      FROM domains d
      JOIN canonical cd USING (domain)
      JOIN live l ON l.id = d.id
      WHERE l.org IS NULL
        OR position(cd.org IN l.org) > 0 OR position(l.org IN cd.org) > 0
      ORDER BY d.id, cd.canonical
    ), by_name AS (
      SELECT DISTINCT ON (org) org, canonical AS domain
      FROM canonical ORDER BY org, canonical
    ), assigned AS (
      SELECT l.id, l.raw, l.org,
        coalesce('d:' || e.domain, 'd:' || n.domain, 'n:' || l.org) AS key,
        coalesce(e.org, l.org) AS cluster_org
      FROM live l
      LEFT JOIN by_email e ON e.id = l.id
      LEFT JOIN by_name n ON n.org = l.org
    )
  `;
}

/**
 * The companies the workspace's live contacts work at, biggest first, each
 * named by its most common spelling. `search` matches any spelling.
 */
export async function listContactOrganizations(
  actor: ContactActor,
  options: { search?: string; limit: number },
): Promise<{ name: string; count: number }[]> {
  const search = options.search
    ? PrismaRaw.sql`HAVING bool_or(raw ILIKE ${literalSubstringPattern(options.search)} ESCAPE '\\')`
    : PrismaRaw.empty;
  return prisma.$queryRaw<{ name: string; count: number }[]>`
    ${contactCompaniesCte(actor.workspaceId)}
    SELECT mode() WITHIN GROUP (ORDER BY raw) FILTER (WHERE org = cluster_org) AS name,
      count(*)::int AS count
    FROM assigned
    WHERE key IS NOT NULL
    GROUP BY key
    ${search}
    ORDER BY count DESC, name ASC
    LIMIT ${options.limit}
  `;
}

/** The live contacts at the company `name` belongs to, by any spelling. */
async function contactCompanyMemberIds(
  workspaceId: string,
  name: string,
): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    ${contactCompaniesCte(workspaceId)}
    SELECT id FROM assigned
    WHERE key IN (
      SELECT key FROM assigned
      WHERE org = regexp_replace(lower(${name}), '[^[:alnum:]]+', '', 'g')
    )
  `;
  return rows.map((row) => row.id);
}

/** Every match, for export; bounded so one request cannot load a city. */
export async function allContacts(
  actor: ContactActor,
  options: Omit<ListContactsOptions, "cursor" | "limit">,
  max = 10_000,
): Promise<ContactDto[]> {
  const items: ContactDto[] = [];
  let cursor: string | undefined;
  while (items.length < max) {
    const page = await listContacts(actor, {
      ...options,
      cursor,
      limit: 100,
    });
    items.push(...page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return items.slice(0, max);
}

/**
 * Sets how much a contact matters to the caller: by hand, or by their Soko
 * Bot when one acts. Null hands it back to Jev.
 */
export async function setReaderImportance(
  tx: Tx,
  actor: ContactActor,
  id: string,
  importance: number | null,
): Promise<ContactDto> {
  await setContactImportance(tx, {
    workspaceId: actor.workspaceId,
    userId: actor.userId,
    contactId: id,
    importance,
    source: actor.sokoBotId ? "SOKO_BOT" : "MANUAL",
  });
  return loadContactDto(tx, id, actor.userId);
}

export async function getContactDetail(
  actor: ContactActor,
  id: string,
): Promise<ContactDetailDto> {
  await requireContactRow(prisma, actor, id);
  const contact = await loadContactDto(prisma, id, actor.userId);
  const recent = await prisma.contactInteraction.findMany({
    where: { contactId: id },
    include: INTERACTION_INCLUDE,
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: 10,
  });
  const duplicates = contact.mergedIntoId
    ? []
    : await findDuplicateContacts(actor, { contactId: id, limit: 5 });
  return {
    ...contact,
    recentInteractions: recent.map(toInteractionDto),
    mergeSuggestions: duplicates.map((group) => ({
      reason: "same_name" as const,
      contactIds: group.contacts.map((entry) => entry.id),
    })),
  };
}

export async function listContactInteractions(
  actor: ContactActor,
  contactId: string,
  page: { cursor?: string; limit: number },
): Promise<{
  items: InteractionDto[];
  total: number;
  nextCursor: string | null;
}> {
  await requireContactRow(prisma, actor, contactId);
  const where = { contactId };
  const [rows, total] = await prisma.$transaction([
    prisma.contactInteraction.findMany({
      where,
      include: INTERACTION_INCLUDE,
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: page.limit + 1,
      ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
    }),
    prisma.contactInteraction.count({ where }),
  ]);
  const items = rows.slice(0, page.limit);
  return {
    items: items.map(toInteractionDto),
    total,
    nextCursor: rows.length > page.limit ? (items.at(-1)?.id ?? null) : null,
  };
}

export async function listContactActivity(
  actor: ContactActor,
  contactId: string,
  page: { cursor?: string; limit: number },
): Promise<{ items: ActivityDto[]; total: number; nextCursor: string | null }> {
  await requireContactRow(prisma, actor, contactId);
  const where = { contactId };
  const [rows, total] = await prisma.$transaction([
    prisma.contactActivity.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: page.limit + 1,
      ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
    }),
    prisma.contactActivity.count({ where }),
  ]);
  const items = rows.slice(0, page.limit);
  const userIds = [
    ...new Set(items.flatMap((row) => (row.userId ? [row.userId] : []))),
  ];
  const botIds = [
    ...new Set(items.flatMap((row) => (row.sokoBotId ? [row.sokoBotId] : []))),
  ];
  const [users, bots] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, image: true },
    }),
    prisma.sokoBot.findMany({
      where: { id: { in: botIds } },
      select: { id: true, name: true },
    }),
  ]);
  const userById = new Map(users.map((user) => [user.id, user]));
  const botById = new Map(bots.map((bot) => [bot.id, bot]));
  return {
    items: items.map((row) => ({
      id: row.id,
      kind: row.kind,
      changes: jsonObject(row.changes),
      user: (row.userId && userById.get(row.userId)) || null,
      sokoBot: (row.sokoBotId && botById.get(row.sokoBotId)) || null,
      createdAt: row.createdAt,
    })),
    total,
    nextCursor: rows.length > page.limit ? (items.at(-1)?.id ?? null) : null,
  };
}

const CAPTURE_CHANNEL_SOURCE = {
  EMAIL: "EMAIL",
  MEETING: "CALENDAR",
  SLACK: "SLACK",
  CALL: "OTHER",
  MANUAL: "MANUAL",
  OTHER: "OTHER",
} as const satisfies Record<
  InteractionInput["channel"],
  NonNullable<ChannelInput["source"]>
>;

/** Whether `name` is only what `contactNameFromChannel` made of an address. */
function isPlaceholderName(
  name: string,
  channels: readonly { type: ContactChannelType; value: string }[],
): boolean {
  return channels.some(
    (channel) => contactNameFromChannel(channel.type, channel.value) === name,
  );
}

/**
 * The entry point automatic capture calls for one message or meeting: finds
 * or creates the person by channel (filling only what is empty) and logs the
 * interaction for the teammate who had it, idempotently by `sourceRef`. A
 * name made up from an address gives way to the person's real name. A new or
 * changed contact is queued for enrichment.
 */
export async function captureContactInteraction(
  tx: Tx,
  actor: ContactActor,
  input: {
    name?: string;
    organization?: string;
    role?: string;
    channels: ChannelInput[];
    interaction: InteractionInput;
    teammateUserId: string;
  },
): Promise<UpsertContactResult & { interactionCreated: boolean }> {
  // "Praxis", "Office" or "Acme GmbH" writing as itself is an
  // organization or shared inbox, not a person.
  const kind =
    input.name && isNonPersonName(input.name) ? "ORGANIZATION" : undefined;
  const upserted = await upsertContact(
    tx,
    actor,
    {
      name: input.name,
      kind,
      organization: input.organization,
      role: input.role,
      channels: input.channels,
      upsert: true,
    },
    { defaultChannelSource: CAPTURE_CHANNEL_SOURCE[input.interaction.channel] },
  );
  let changed = upserted.changed;
  const current = upserted.contact;
  if (
    !upserted.created &&
    input.name &&
    input.name !== current.name &&
    isPlaceholderName(current.name, current.channels)
  ) {
    // A real name arriving is worth judging the person again.
    await tx.contact.update({
      where: { id: current.id },
      data: {
        name: input.name,
        ...(kind ? { kind } : {}),
        classifiedAt: null,
        version: { increment: 1 },
      },
    });
    await recordActivity(tx, actor, current.id, "UPDATED", {
      name: { before: current.name, after: input.name },
      ...(kind && current.kind !== kind
        ? { kind: { before: current.kind, after: kind } }
        : {}),
    });
    changed = true;
  }
  if (upserted.created || changed)
    await tx.contact.update({
      where: { id: current.id },
      data: { enrichedAt: null },
    });
  const logged = await logContactInteraction(
    tx,
    actor,
    current.id,
    input.interaction,
    { userId: input.teammateUserId },
  );
  return {
    ...upserted,
    changed,
    contact:
      logged.created || changed
        ? await loadContactDto(tx, current.id, actor.userId)
        : current,
    interactionCreated: logged.created,
  };
}

/** Fields the background enrichment may fill. */
export interface ContactEnrichment {
  organization?: string;
  role?: string;
  summary?: string;
}

/**
 * Fills the empty ones of `fields` and records where each value came from
 * (`sources`: the interactions it was read from, `sourceUrls` where one was
 * linked) next to the change in the contact's history. Never overwrites, and
 * marks the contact enriched either way. Returns the fields it filled.
 */
export async function enrichContactFields(
  tx: Tx,
  actor: ContactActor,
  id: string,
  fields: ContactEnrichment,
  provenance: { method: string; sources: string[]; sourceUrls: string[] },
): Promise<string[]> {
  const contact = await requireWritableContact(tx, actor, id);
  const data = fillEmpty(contact, fieldData(fields));
  const changes = changedFields(contact, data);
  const filled = Object.keys(changes);
  await tx.contact.update({
    where: { id },
    data: {
      ...data,
      enrichedAt: new Date(),
      ...(filled.length ? { version: { increment: 1 } } : {}),
    },
  });
  if (filled.length)
    await recordActivity(
      tx,
      actor,
      id,
      "UPDATED",
      Object.fromEntries(
        Object.entries(changes).map(([field, change]) => [
          field,
          {
            ...change,
            source: provenance.method,
            evidence: provenance.sources.slice(0, 10),
            sourceUrls: provenance.sourceUrls.slice(0, 5),
          },
        ]),
      ),
    );
  return filled;
}

/** Fields people changed by hand on a contact, from its history. */
export async function personEditedFields(
  tx: Tx,
  contactId: string,
): Promise<Set<string>> {
  const edits = await tx.contactActivity.findMany({
    where: { contactId, kind: "UPDATED", sokoBotId: null },
    select: { changes: true },
  });
  return new Set(
    edits.flatMap((edit) => Object.keys(jsonObject(edit.changes))),
  );
}

/** Whether a contact's name is only what one of its addresses made of it. */
export function hasPlaceholderName(contact: {
  name: string;
  channels: readonly { type: string; value: string }[];
}): boolean {
  return isPlaceholderName(
    contact.name,
    contact.channels.flatMap((channel) => {
      const type = CONTACT_CHANNEL_TYPES.find((item) => item === channel.type);
      return type ? [{ type, value: channel.value }] : [];
    }),
  );
}

/**
 * Applies the background classifier's kind, name and stage (already checked
 * by `classificationChanges`), records each with its source, and marks the
 * contact classified either way. Returns the fields it changed.
 */
export async function applyContactClassification(
  tx: Tx,
  actor: ContactActor,
  id: string,
  changes: {
    kind?: "PERSON" | "ORGANIZATION";
    name?: string;
    stage?: z.infer<typeof contactFieldsSchema>["stage"];
  },
  provenance: { method: string },
): Promise<string[]> {
  const contact = await requireWritableContact(tx, actor, id);
  const diff = changedFields(contact, changes);
  const changed = Object.keys(diff);
  await tx.contact.update({
    where: { id },
    data: {
      ...(changed.length ? { ...changes, version: { increment: 1 } } : {}),
      classifiedAt: new Date(),
    },
  });
  if (changed.length)
    await recordActivity(
      tx,
      actor,
      id,
      "UPDATED",
      Object.fromEntries(
        Object.entries(diff).map(([field, change]) => [
          field,
          { ...change, source: provenance.method },
        ]),
      ),
    );
  return changed;
}
