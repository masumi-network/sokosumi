"use client";
import type { Contact, PatchContactsByIdData } from "@sokosumi/core-client";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { coreErrorOf } from "@/app/contacts/contacts-view";
import { contactsService } from "@/lib/services/contacts.client";
import {
  CONTACT_LISTS_KEY,
  contactKey,
  refreshContacts,
  writeContact,
} from "./use-contacts-data";

export type ContactFields = Omit<
  NonNullable<PatchContactsByIdData["body"]>,
  "version"
>;

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
