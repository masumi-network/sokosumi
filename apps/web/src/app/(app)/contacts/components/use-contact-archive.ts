"use client";
import type { Contact } from "@sokosumi/core-client";
import { type InfiniteData, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { coreErrorOf } from "@/app/contacts/contacts-view";
import { contactsService } from "@/lib/services/contacts.client";
import { CONTACTS_KEY, refreshContacts } from "./use-contacts-data";

type Page = { contacts: Contact[]; total: number };

/**
 * Archives a contact. Its row leaves the loaded pages and `onDone` runs at
 * once; the reload after the save, or after a failure, shows what Core holds,
 * so a contact that could not be archived comes back.
 */
export function useContactArchive() {
  const t = useTranslations("App.Contacts");
  const cache = useQueryClient();
  return async function archive(contact: Contact, onDone: () => void) {
    // A load under way holds the row; a first load has nothing to protect.
    void cache.cancelQueries({
      queryKey: CONTACTS_KEY,
      predicate: (query) => query.state.data !== undefined,
    });
    cache.setQueriesData<InfiniteData<Page>>(
      { queryKey: CONTACTS_KEY },
      (data) => {
        const held = data?.pages.some((page) =>
          page.contacts.some((item) => item.id === contact.id),
        );
        // A query that never held the contact keeps its total.
        if (!data || !held) return data;
        return {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            contacts: page.contacts.filter((item) => item.id !== contact.id),
            total: page.total - 1,
          })),
        };
      },
    );
    onDone();
    try {
      await contactsService.archive(contact.id);
      toast.success(t("panel.archived", { name: contact.name }));
    } catch (error) {
      toast.error(t("panel.archiveFailed", { name: contact.name }), {
        description: coreErrorOf(error).message,
      });
    }
    await refreshContacts(cache, contact.id);
  };
}
