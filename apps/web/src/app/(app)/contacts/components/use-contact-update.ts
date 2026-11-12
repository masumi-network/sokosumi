"use client";
import type {
  Contact,
  ContactList,
  PatchContactsByIdData,
} from "@sokosumi/core-client";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRef } from "react";
import { toast } from "sonner";
import { coreErrorOf } from "@/app/contacts/contacts-view";
import { contactsService } from "@/lib/services/contacts.client";
import {
  CONTACT_BREAKDOWN_KEY,
  CONTACT_COMPANY_KEY,
  CONTACT_DUPLICATES_KEY,
  CONTACT_LISTS_KEY,
  CONTACT_MAP_KEY,
  CONTACTS_KEY,
  contactKey,
  refreshContacts,
  writeContact,
} from "./use-contacts-data";

export type ContactFields = Omit<
  NonNullable<PatchContactsByIdData["body"]>,
  "version"
>;

/**
 * Sets how much a contact matters to the reader, or hands it back to Jev
 * with null. The row changes at once and goes back on failure.
 */
export function useImportanceUpdate() {
  const t = useTranslations("App.Contacts");
  const cache = useQueryClient();
  return async function setImportance(
    contact: Contact,
    importance: number | null,
  ): Promise<boolean> {
    writeContact(cache, {
      ...contact,
      score: {
        familiarity: contact.score?.familiarity ?? 0,
        importance,
        importanceSource: importance === null ? null : "MANUAL",
        importanceReason: null,
      },
    });
    try {
      writeContact(
        cache,
        await contactsService.setImportance(contact.id, importance),
      );
      void cache.invalidateQueries({ queryKey: contactKey(contact.id) });
      // A list sorted by importance has a new order.
      void cache.invalidateQueries({ queryKey: CONTACTS_KEY });
      return true;
    } catch (error) {
      writeContact(cache, contact);
      toast.error(coreErrorOf(error).message ?? t("errors.saveFailed"));
      return false;
    }
  };
}

/**
 * Saves fields on the version the reader saw. The row changes at once; a
 * stale version (someone else saved first) reloads the contact and says so,
 * any other failure puts the old values back.
 */
export function useContactUpdate() {
  const t = useTranslations("App.Contacts");
  const cache = useQueryClient();
  return async function update(
    contact: Contact,
    fields: ContactFields,
    optimistic: Partial<Contact> = {},
  ): Promise<boolean> {
    writeContact(cache, { ...contact, ...fields, ...optimistic } as Contact);
    try {
      const saved = await contactsService.update(contact.id, {
        ...fields,
        version: contact.version,
      });
      // Rows keep their place until the next load, so an edit under a sort
      // by "Updated" does not pull the row out from under the reader.
      writeContact(cache, saved);
      void cache.invalidateQueries({ queryKey: CONTACT_LISTS_KEY });
      void cache.invalidateQueries({ queryKey: CONTACT_MAP_KEY });
      void cache.invalidateQueries({ queryKey: CONTACT_COMPANY_KEY });
      void cache.invalidateQueries({ queryKey: CONTACT_BREAKDOWN_KEY });
      // A new name or organization can make or end a duplicate group.
      void cache.invalidateQueries({ queryKey: CONTACT_DUPLICATES_KEY });
      void cache.invalidateQueries({ queryKey: contactKey(contact.id) });
      void cache.invalidateQueries({
        queryKey: ["contact-timeline", contact.id],
      });
      return true;
    } catch (error) {
      writeContact(cache, contact);
      const { kind, message } = coreErrorOf(error);
      if (kind === "contact_version_conflict") {
        toast.error(t("errors.versionConflict"));
        await refreshContacts(cache, contact.id);
      } else toast.error(message ?? t("errors.saveFailed"));
      return false;
    }
  };
}

/**
 * Puts a contact on a manual list or takes it off. The chip changes at once.
 * Saves go to Core one after the other, in the order of the clicks, and the
 * reload waits for the last of them: a reload between two saves would show
 * the lists from before the second one.
 */
export function useListToggle() {
  const t = useTranslations("App.Contacts");
  const cache = useQueryClient();
  const saves = useRef({ open: 0, last: Promise.resolve() }).current;
  return async function toggleList(
    contact: Contact,
    list: ContactList,
    on: boolean,
  ) {
    const { id, name, color } = list;
    // A load under way holds the lists from before this click.
    void cache.cancelQueries({ queryKey: contactKey(contact.id) });
    // Pages still on their first load have nothing to protect; cancelling
    // that load would leave the grid empty until the reload.
    void cache.cancelQueries({
      queryKey: CONTACTS_KEY,
      predicate: (query) => query.state.data !== undefined,
    });
    writeContact(cache, {
      ...contact,
      lists: on
        ? [...contact.lists, { id, name, color, addedAutomatically: false }]
        : contact.lists.filter((item) => item.id !== id),
    });
    saves.open += 1;
    const save = saves.last.then(() =>
      contactsService.changeMembers(
        id,
        on ? { add: [contact.id] } : { remove: [contact.id] },
      ),
    );
    saves.last = save.then(
      () => {},
      () => {},
    );
    try {
      await save;
    } catch (error) {
      toast.error(coreErrorOf(error).message ?? t("errors.saveFailed"));
    }
    saves.open -= 1;
    if (saves.open === 0) await refreshContacts(cache, contact.id);
  };
}
