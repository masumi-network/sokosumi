"use client";

import type { Contact } from "@sokosumi/core-client";
import { useQuery } from "@tanstack/react-query";
import { contactsService } from "@/lib/services/contacts.client";

/**
 * The People group inside global search: the workspace's Contacts whose
 * name, company, email or other channel matches. Like Files, it reads the
 * dialog's debounced query, keys on the workspace, and a failure only hides
 * the group.
 */

export const GLOBAL_SEARCH_CONTACTS_LIMIT = 5;

export function useContactSearchGroup(input: {
  open: boolean;
  activeOrganizationId: string | null;
  debouncedQuery: string;
}): { contacts: Contact[] } {
  const search = input.debouncedQuery.trim();
  const { data } = useQuery({
    queryKey: ["contact-search-group", input.activeOrganizationId, search],
    queryFn: async () =>
      (
        await contactsService.list({
          search,
          limit: GLOBAL_SEARCH_CONTACTS_LIMIT,
        })
      ).contacts,
    enabled: input.open && search.length > 0,
  });
  return { contacts: data ?? [] };
}
