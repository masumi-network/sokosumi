import type { Prisma } from "@sokosumi/database";
import {
  SOKO_BOT_TOOL_INPUT_SCHEMAS,
  type SokoBotCapability,
} from "@sokosumi/soko-bot";
import { unprocessableEntity } from "@/helpers/error";
import { breakDownContacts } from "@/services/contact-breakdown.service";
import {
  getCompany,
  listCompanies,
  updateCompanyFacts,
} from "@/services/contact-companies.service";
import {
  createContactList,
  deleteContactList,
  listContactLists,
  updateContactList,
  updateContactListMembers,
} from "@/services/contact-lists.service";
import {
  addContactChannel,
  type ContactActor,
  findDuplicateContacts,
  getContactDetail,
  inContactTransaction,
  listContacts,
  logContactInteraction,
  mergeContacts,
  removeContactChannel,
  setContactArchived,
  setReaderImportance,
  updateContact,
  upsertContact,
} from "@/services/contacts.service";

type Tx = Prisma.TransactionClient;
type ContactDto = Awaited<ReturnType<typeof listContacts>>["items"][number];

export const CONTACT_READ_CAPABILITIES = [
  "search_contacts",
  "count_contacts",
  "get_contact",
  "list_contact_lists",
  "find_contact_duplicates",
  "search_companies",
  "get_company",
] as const satisfies readonly SokoBotCapability[];

export const CONTACT_WRITE_CAPABILITIES = [
  "upsert_contact",
  "update_contact",
  "log_contact_interaction",
  "merge_contacts",
  "manage_contact_lists",
  "update_company",
] as const satisfies readonly SokoBotCapability[];

type ContactCapability =
  | (typeof CONTACT_READ_CAPABILITIES)[number]
  | (typeof CONTACT_WRITE_CAPABILITIES)[number];

export function isContactCapability(
  capability: string,
): capability is ContactCapability {
  return (
    (CONTACT_READ_CAPABILITIES as readonly string[]).includes(capability) ||
    (CONTACT_WRITE_CAPABILITIES as readonly string[]).includes(capability)
  );
}

export interface ContactWriteHooks {
  /** Turn still writable and the capability granted; in the write's transaction. */
  authorize(tx: Tx): Promise<unknown>;
  /** The action receipt, committed with the write. */
  commit(tx: Tx, targetId: string, result: unknown): Promise<unknown>;
}

/**
 * Runs a contacts tool for a Soko Bot. Reads go straight to the services;
 * each write runs in one serializable transaction that checks the turn may
 * still write, applies the change and commits its receipt, so a receipt
 * exists exactly when the change does.
 */
export async function runContactTool(
  capability: ContactCapability,
  rawInput: unknown,
  actor: ContactActor,
  hooks: ContactWriteHooks,
): Promise<unknown> {
  const write = <T>(
    change: (tx: Tx) => Promise<T>,
    target: (result: T) => string,
  ) =>
    inContactTransaction(async (tx) => {
      await hooks.authorize(tx);
      const result = await change(tx);
      await hooks.commit(tx, target(result), result);
      return result;
    });

  switch (capability) {
    case "search_companies": {
      const page = await listCompanies(
        actor,
        SOKO_BOT_TOOL_INPUT_SCHEMAS.search_companies.parse(rawInput),
      );
      return { companies: page.items, total: page.total };
    }
    case "get_company": {
      const detail = await getCompany(
        actor,
        SOKO_BOT_TOOL_INPUT_SCHEMAS.get_company.parse(rawInput).companyId,
      );
      return {
        ...detail,
        people: detail.people.map((person) =>
          compactContact(person, new Set()),
        ),
      };
    }
    case "update_company": {
      const { companyId, ...input } =
        SOKO_BOT_TOOL_INPUT_SCHEMAS.update_company.parse(rawInput);
      await write(
        async (tx) => {
          await updateCompanyFacts(tx, actor, companyId, input);
          return { companyId, changed: Object.keys(input) };
        },
        () => companyId,
      );
      return (await getCompany(actor, companyId)).company;
    }
    case "search_contacts": {
      const {
        query,
        mode,
        company,
        listId,
        archived,
        sort,
        direction,
        cursor,
        limit,
        fields,
        ...filter
      } = SOKO_BOT_TOOL_INPUT_SCHEMAS.search_contacts.parse(rawInput);
      const page = await listContacts(actor, {
        filter,
        query,
        mode,
        company,
        listId,
        archived,
        sort,
        direction,
        cursor,
        limit,
      });
      const extra = new Set<string>(fields ?? []);
      return {
        contacts: page.items.map((contact) => compactContact(contact, extra)),
        total: page.total,
        nextCursor: page.nextCursor,
      };
    }
    case "count_contacts": {
      const { query, mode, company, listId, by, top, ...filter } =
        SOKO_BOT_TOOL_INPUT_SCHEMAS.count_contacts.parse(rawInput);
      return breakDownContacts(actor, {
        filter,
        query,
        mode,
        company,
        listId,
        by,
        top,
      });
    }
    case "get_contact":
      return getContactDetail(
        actor,
        SOKO_BOT_TOOL_INPUT_SCHEMAS.get_contact.parse(rawInput).contactId,
      );
    case "list_contact_lists":
      return { lists: await listContactLists(actor) };
    case "find_contact_duplicates":
      return {
        groups: await findDuplicateContacts(
          actor,
          SOKO_BOT_TOOL_INPUT_SCHEMAS.find_contact_duplicates.parse(rawInput),
        ),
      };
    case "upsert_contact": {
      const input = SOKO_BOT_TOOL_INPUT_SCHEMAS.upsert_contact.parse(rawInput);
      // A bot never creates a second entry for an address it already has.
      return write(
        (tx) => upsertContact(tx, actor, { ...input, upsert: true }),
        (result) => result.contact.id,
      );
    }
    case "update_contact": {
      const {
        contactId,
        version,
        addChannels,
        removeChannelIds,
        archived,
        importance,
        ...fields
      } = SOKO_BOT_TOOL_INPUT_SCHEMAS.update_contact.parse(rawInput);
      return write(
        async (tx) => {
          let contact = await updateContact(tx, actor, contactId, {
            ...fields,
            version,
          });
          for (const channel of addChannels ?? [])
            contact = await addContactChannel(tx, actor, contactId, channel);
          for (const channelId of removeChannelIds ?? [])
            contact = await removeContactChannel(
              tx,
              actor,
              contactId,
              channelId,
            );
          if (archived !== undefined)
            contact = await setContactArchived(tx, actor, contactId, archived);
          if (importance !== undefined)
            contact = await setReaderImportance(
              tx,
              actor,
              contactId,
              importance,
            );
          return contact;
        },
        (contact) => contact.id,
      );
    }
    case "log_contact_interaction": {
      const { contactId, ...interaction } =
        SOKO_BOT_TOOL_INPUT_SCHEMAS.log_contact_interaction.parse(rawInput);
      return write(
        (tx) => logContactInteraction(tx, actor, contactId, interaction),
        () => contactId,
      );
    }
    case "merge_contacts": {
      const { winnerId, loserIds } =
        SOKO_BOT_TOOL_INPUT_SCHEMAS.merge_contacts.parse(rawInput);
      return write(
        (tx) => mergeContacts(tx, actor, winnerId, loserIds),
        (contact) => contact.id,
      );
    }
    case "manage_contact_lists":
      return manageContactLists(rawInput, actor, write);
  }
}

async function manageContactLists(
  rawInput: unknown,
  actor: ContactActor,
  write: <T>(
    change: (tx: Tx) => Promise<T>,
    target: (result: T) => string,
  ) => Promise<T>,
) {
  const { action, listId, contactIds, ...fields } =
    SOKO_BOT_TOOL_INPUT_SCHEMAS.manage_contact_lists.parse(rawInput);
  if (action === "create") {
    if (!fields.name) throw unprocessableEntity("A new list needs a name");
    const name = fields.name;
    return write(
      (tx) =>
        createContactList(tx, actor, {
          ...fields,
          name,
          color: fields.color ?? "gray",
        }),
      (list) => list.id,
    );
  }
  if (!listId) throw unprocessableEntity("listId is required");
  switch (action) {
    case "update":
      return write(
        (tx) => updateContactList(tx, actor, listId, fields),
        (list) => list.id,
      );
    case "delete":
      return write(
        async (tx) => {
          await deleteContactList(tx, actor, listId);
          return { deleted: true, listId };
        },
        () => listId,
      );
    case "add":
    case "remove":
      return write(
        (tx) =>
          updateContactListMembers(tx, actor, listId, {
            add: action === "add" ? (contactIds ?? []) : [],
            remove: action === "remove" ? (contactIds ?? []) : [],
          }),
        (list) => list.id,
      );
  }
}

/**
 * A contact as a search answers it: what tells people apart and reaches
 * them, plus the `extra` fields asked for. Thousands of full contacts would
 * flood a turn; get_contact reads one in full.
 */
function compactContact(contact: ContactDto, extra: ReadonlySet<string>) {
  const pick = <K extends keyof ContactDto>(key: K) =>
    extra.has(key) ? { [key]: contact[key] } : {};
  return {
    id: contact.id,
    name: contact.name,
    kind: contact.kind,
    organization: contact.organization,
    role: contact.role,
    location: contact.location,
    stage: contact.stage,
    replyState: contact.replyState,
    lastContactAt: contact.lastContactAt,
    interactionCount: contact.interactionCount,
    version: contact.version,
    channels: extra.has("channelDetails")
      ? contact.channels
      : contact.channels.map(({ type, value, followers }) =>
          followers === null ? { type, value } : { type, value, followers },
        ),
    lists: contact.lists.map((list) => list.name),
    ...pick("summary"),
    ...pick("whyInteresting"),
    ...pick("nextStep"),
    ...pick("followUpAt"),
    ...pick("knownBy"),
    ...pick("score"),
    ...pick("customFields"),
    ...pick("avatarUrl"),
    ...pick("firstContactAt"),
    ...pick("createdAt"),
  };
}
