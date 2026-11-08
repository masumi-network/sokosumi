"use client";
import type { Contact, ContactDetail } from "@sokosumi/core-client";
import {
  type InfiniteData,
  type QueryClient,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import { useSession } from "@/lib/auth/auth.client";
import {
  type ContactQuery,
  contactsService,
} from "@/lib/services/contacts.client";

export const CONTACTS_KEY = ["contacts"] as const;
export const CONTACT_LISTS_KEY = ["contact-lists"] as const;
export const CONTACT_ORGANIZATIONS_KEY = ["contact-organizations"] as const;
export const CONTACT_MAP_KEY = ["contact-map"] as const;
export const CONTACT_COMPANY_KEY = ["contact-company"] as const;
export const CONTACT_BREAKDOWN_KEY = ["contact-breakdown"] as const;
export const contactKey = (id: string) => ["contact", id] as const;

const PAGE_SIZE = 50;

type ContactPage = Awaited<ReturnType<typeof contactsService.list>>;

export function useContactRows(query: ContactQuery) {
  return useInfiniteQuery({
    queryKey: [...CONTACTS_KEY, query],
    queryFn: ({ pageParam }) =>
      contactsService.list({
        ...query,
        limit: PAGE_SIZE,
        cursor: pageParam ?? undefined,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    placeholderData: (previous) => previous,
  });
}

/** Polls while Core looks places up, for at most this many times. */
const MAP_POLLS = 15;

/** The query's contacts by place; the order does not matter on a map. */
export function useContactMap(query: ContactQuery, enabled = true) {
  const { sort: _sort, direction: _direction, ...filters } = query;
  return useQuery({
    enabled,
    queryKey: [...CONTACT_MAP_KEY, filters],
    queryFn: () => contactsService.map(filters),
    placeholderData: (previous) => previous,
    refetchInterval: ({ state }) =>
      (state.data?.pending ?? 0) > 0 && state.dataUpdateCount < MAP_POLLS
        ? 2_000
        : false,
  });
}

export function useContactLists() {
  return useQuery({
    queryKey: CONTACT_LISTS_KEY,
    queryFn: () => contactsService.lists(),
  });
}

/** The biggest companies, or Core's matches for `search` among all of them. */
export function useContactOrganizations(search: string) {
  return useQuery({
    queryKey: [...CONTACT_ORGANIZATIONS_KEY, search],
    queryFn: () => contactsService.organizations(search || undefined),
    placeholderData: (previous) => previous,
  });
}

const OVERVIEW = [
  "stage",
  "organization",
  "location",
  "knownBy",
  "lastContact",
];

/** A list's overview: its people split by stage, company, place, teammate, recency. */
export function useContactBreakdown(query: ContactQuery, enabled: boolean) {
  const { sort: _sort, direction: _direction, ...filters } = query;
  return useQuery({
    enabled,
    queryKey: [...CONTACT_BREAKDOWN_KEY, filters],
    queryFn: () => contactsService.breakdown(filters, OVERVIEW),
    placeholderData: (previous) => previous,
  });
}

/** The company `name` belongs to, in full: facts, people, teammates, touchpoints. */
export function useContactCompany(name: string | null) {
  return useQuery({
    enabled: !!name,
    queryKey: [...CONTACT_COMPANY_KEY, name],
    queryFn: async () => {
      const company = await contactsService.companyNamed(name as string);
      return company ? contactsService.company(company.id) : null;
    },
  });
}

export interface Teammate {
  id: string;
  name: string;
  image: string | null;
}

/** Who can own a contact: the workspace's members, or just the reader. */
export function useTeammates(): { teammates: Teammate[] } {
  const { data: session } = useSession();
  const organizationId = session?.session.activeOrganizationId ?? null;
  const members = useQuery({
    enabled: !!organizationId,
    queryKey: ["contact-teammates", organizationId],
    queryFn: () => contactsService.members(organizationId as string),
    staleTime: 5 * 60_000,
  });
  const teammates: Teammate[] =
    members.data?.map((member) => ({
      id: member.user.id,
      name: member.user.name,
      image: member.user.image,
    })) ??
    (session
      ? [
          {
            id: session.user.id,
            name: session.user.name,
            image: session.user.image ?? null,
          },
        ]
      : []);
  return { teammates };
}

/** Puts a saved contact everywhere it is shown, without a refetch. */
export function writeContact(cache: QueryClient, contact: Contact) {
  cache.setQueriesData<InfiniteData<ContactPage>>(
    { queryKey: CONTACTS_KEY },
    (data) =>
      data && {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          contacts: page.contacts.map((item) =>
            item.id === contact.id ? contact : item,
          ),
        })),
      },
  );
  cache.setQueryData<ContactDetail>(
    contactKey(contact.id),
    (detail) => detail && { ...detail, ...contact },
  );
}

/** After a write whose effects reach counts, lists or other rows. */
export async function refreshContacts(cache: QueryClient, contactId?: string) {
  await Promise.all([
    cache.invalidateQueries({ queryKey: CONTACTS_KEY }),
    cache.invalidateQueries({ queryKey: CONTACT_LISTS_KEY }),
    cache.invalidateQueries({ queryKey: CONTACT_ORGANIZATIONS_KEY }),
    cache.invalidateQueries({ queryKey: CONTACT_MAP_KEY }),
    cache.invalidateQueries({ queryKey: CONTACT_COMPANY_KEY }),
    cache.invalidateQueries({ queryKey: CONTACT_BREAKDOWN_KEY }),
    contactId
      ? cache.invalidateQueries({ queryKey: contactKey(contactId) })
      : null,
    contactId
      ? cache.invalidateQueries({ queryKey: ["contact-timeline", contactId] })
      : null,
  ]);
}
