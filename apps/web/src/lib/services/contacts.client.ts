import {
  deleteContactListsById,
  deleteContactsByIdChannelsByChannelId,
  type GetContactsData,
  getContactLists,
  getContactListsByIdSuggestions,
  getContacts,
  getContactsById,
  getContactsByIdActivity,
  getContactsByIdInteractions,
  getContactsDuplicates,
  getContactsExportCsv,
  getContactsOrganizations,
  getOrganizationsByIdMembers,
  type PatchContactListsByIdData,
  type PatchContactsByIdData,
  type PostContactListsData,
  type PostContactsByIdChannelsData,
  type PostContactsData,
  type PostContactsImportData,
  patchContactListsById,
  patchContactsById,
  postContactLists,
  postContactListsByIdFind,
  postContactListsByIdMembers,
  postContactListsByIdSuggestionsAdd,
  postContactListsByIdSuggestionsDismiss,
  postContacts,
  postContactsByIdArchive,
  postContactsByIdChannels,
  postContactsByIdEnrich,
  postContactsImport,
  postContactsMerge,
  putContactsByIdImportance,
} from "@sokosumi/core-client";
import { getBrowserCoreClient } from "@/lib/clients/core.browser.client";

export type ContactQuery = NonNullable<GetContactsData["query"]>;

function options() {
  return { client: getBrowserCoreClient(), throwOnError: true as const };
}

/** The Contacts tab's reads and writes, from the browser through Core. */
export const contactsService = {
  async list(query: ContactQuery) {
    const { data } = await getContacts({ ...options(), query });
    return {
      contacts: data.data,
      nextCursor: data.meta.pagination.nextCursor,
      total: data.meta.pagination.total,
    };
  },
  /** The organizations contacts work at, biggest first. */
  async organizations(search?: string) {
    return (
      await getContactsOrganizations({
        ...options(),
        query: { limit: 50, ...(search ? { search } : {}) },
      })
    ).data.data;
  },
  /** How much a contact matters to the reader; null lets Jev judge it. */
  async setImportance(id: string, importance: number | null) {
    return (
      await putContactsByIdImportance({
        ...options(),
        path: { id },
        body: { importance },
      })
    ).data.data;
  },
  async get(id: string) {
    return (await getContactsById({ ...options(), path: { id } })).data.data;
  },
  async create(body: NonNullable<PostContactsData["body"]>) {
    return (await postContacts({ ...options(), body })).data.data;
  },
  async update(id: string, body: NonNullable<PatchContactsByIdData["body"]>) {
    return (await patchContactsById({ ...options(), path: { id }, body })).data
      .data;
  },
  async archive(id: string) {
    return (await postContactsByIdArchive({ ...options(), path: { id } })).data
      .data;
  },
  async addChannel(
    id: string,
    body: NonNullable<PostContactsByIdChannelsData["body"]>,
  ) {
    return (
      await postContactsByIdChannels({ ...options(), path: { id }, body })
    ).data.data;
  },
  async removeChannel(id: string, channelId: string) {
    await deleteContactsByIdChannelsByChannelId({
      ...options(),
      path: { id, channelId },
    });
  },
  async interactions(id: string, cursor?: string) {
    const { data } = await getContactsByIdInteractions({
      ...options(),
      path: { id },
      query: { cursor, limit: 20 },
    });
    return { items: data.data, nextCursor: data.meta.pagination.nextCursor };
  },
  async activity(id: string, cursor?: string) {
    const { data } = await getContactsByIdActivity({
      ...options(),
      path: { id },
      query: { cursor, limit: 20 },
    });
    return { items: data.data, nextCursor: data.meta.pagination.nextCursor };
  },
  async duplicates(contactId?: string) {
    return (await getContactsDuplicates({ ...options(), query: { contactId } }))
      .data.data;
  },
  async merge(winnerId: string, loserIds: string[]) {
    return (
      await postContactsMerge({ ...options(), body: { winnerId, loserIds } })
    ).data.data;
  },
  async exportCsv(query: ContactQuery): Promise<string> {
    const { data } = await getContactsExportCsv({
      ...options(),
      query,
      parseAs: "text",
    });
    return String(data);
  },
  async importTable(body: NonNullable<PostContactsImportData["body"]>) {
    return (await postContactsImport({ ...options(), body })).data.data;
  },
  async lists() {
    return (await getContactLists({ ...options() })).data.data;
  },
  async createList(body: NonNullable<PostContactListsData["body"]>) {
    return (await postContactLists({ ...options(), body })).data.data;
  },
  async updateList(
    id: string,
    body: NonNullable<PatchContactListsByIdData["body"]>,
  ) {
    return (await patchContactListsById({ ...options(), path: { id }, body }))
      .data.data;
  },
  async deleteList(id: string) {
    await deleteContactListsById({ ...options(), path: { id } });
  },
  async changeMembers(
    listId: string,
    change: { add?: string[]; remove?: string[] },
  ) {
    return (
      await postContactListsByIdMembers({
        ...options(),
        path: { id: listId },
        body: { add: change.add ?? [], remove: change.remove ?? [] },
      })
    ).data.data;
  },
  async suggestions(listId: string) {
    return (
      await getContactListsByIdSuggestions({
        ...options(),
        path: { id: listId },
      })
    ).data.data;
  },
  async findPeople(
    listId: string,
    body: { brief?: string; size: 1 | 10 | 25 },
  ) {
    return (
      await postContactListsByIdFind({
        ...options(),
        path: { id: listId },
        body,
      })
    ).data.data;
  },
  async enrich(id: string) {
    return (await postContactsByIdEnrich({ ...options(), path: { id } })).data
      .data;
  },
  async addSuggestions(listId: string, ids: string[]) {
    return (
      await postContactListsByIdSuggestionsAdd({
        ...options(),
        path: { id: listId },
        body: { ids },
      })
    ).data.data;
  },
  async dismissSuggestions(listId: string, ids: string[]) {
    return (
      await postContactListsByIdSuggestionsDismiss({
        ...options(),
        path: { id: listId },
        body: { ids },
      })
    ).data.data;
  },
  async members(organizationId: string) {
    return (
      await getOrganizationsByIdMembers({
        ...options(),
        path: { id: organizationId },
      })
    ).data.data;
  },
};
