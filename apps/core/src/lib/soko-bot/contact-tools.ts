import type { Prisma } from "@sokosumi/database";
import {
  SOKO_BOT_TOOL_INPUT_SCHEMAS,
  type SokoBotCapability,
} from "@sokosumi/soko-bot";
import { unprocessableEntity } from "@/helpers/error";
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

export const CONTACT_READ_CAPABILITIES = [
  "search_contacts",
  "get_contact",
  "list_contact_lists",
  "find_contact_duplicates",
] as const satisfies readonly SokoBotCapability[];

export const CONTACT_WRITE_CAPABILITIES = [
  "upsert_contact",
  "update_contact",
  "log_contact_interaction",
  "merge_contacts",
  "manage_contact_lists",
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
    case "search_contacts": {
      const { listId, archived, sort, direction, cursor, limit, ...filter } =
        SOKO_BOT_TOOL_INPUT_SCHEMAS.search_contacts.parse(rawInput);
      const page = await listContacts(actor, {
        filter,
        listId,
        archived,
        sort,
        direction,
        cursor,
        limit,
      });
      return {
        contacts: page.items,
        total: page.total,
        nextCursor: page.nextCursor,
      };
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
