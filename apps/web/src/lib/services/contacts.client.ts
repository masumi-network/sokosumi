import {
  type ContactStage,
  deleteContactListsById,
  deleteContactsByIdChannelsByChannelId,
  deleteContactsCompanyListsByListId,
  type GetContactsCompaniesData,
  type GetContactsData,
  getContactLists,
  getContactListsByIdSuggestions,
  getContacts,
  getContactsBreakdown,
  getContactsById,
  getContactsByIdActivity,
  getContactsByIdInteractions,
  getContactsCompanies,
  getContactsCompaniesByCompanyId,
  getContactsCompanyLists,
  getContactsDuplicates,
  getContactsExportCsv,
  getContactsMap,
  getContactsOrganizations,
  getOrganizationsByIdMembers,
  type PatchContactListsByIdData,
  type PatchContactsByIdData,
  type PatchContactsCompaniesByCompanyIdData,
  type PatchContactsCompanyListsByListIdData,
  type PostContactListsData,
  type PostContactsByIdChannelsData,
  type PostContactsCompanyListsData,
  type PostContactsData,
  type PostContactsImportData,
  type PostContactsStageUndoData,
  patchContactListsById,
  patchContactsById,
  patchContactsCompaniesByCompanyId,
  patchContactsCompanyListsByListId,
  postContactLists,
  postContactListsByIdFind,
  postContactListsByIdMembers,
  postContactListsByIdSuggestionsAdd,
  postContactListsByIdSuggestionsDismiss,
  postContacts,
  postContactsByIdArchive,
  postContactsByIdChannels,
  postContactsByIdEnrich,
  postContactsCompanyLists,
  postContactsCompanyListsByListIdMembers,
  postContactsDuplicatesDismiss,
  postContactsImport,
  postContactsMerge,
  postContactsStage,
  postContactsStageUndo,
  putContactsByIdImportance,
} from "@sokosumi/core-client";
import { getBrowserCoreClient } from "@/lib/clients/core.browser.client";

export type ContactQuery = NonNullable<GetContactsData["query"]>;
export type CompanyQuery = NonNullable<GetContactsCompaniesData["query"]>;

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
  /** The query's contacts grouped by where they are. */
  async map(query: ContactQuery) {
    return (await getContactsMap({ ...options(), query })).data.data;
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
  /** How many contacts match, split by each of `by`. */
  async breakdown(query: ContactQuery, by: string[]) {
    const {
      sort: _sort,
      direction: _direction,
      cursor: _cursor,
      limit: _limit,
      ...filters
    } = query;
    return (
      await getContactsBreakdown({
        ...options(),
        query: { ...filters, by: by.join(","), top: 5 },
      })
    ).data.data;
  },
  /** Exactly the company this name belongs to, as the `company` filter reads it. */
  async companyNamed(name: string) {
    const companies = (
      await getContactsCompanies({
        ...options(),
        query: { name, limit: 2 },
      })
    ).data.data;
    return companies.length === 1 ? (companies[0] ?? null) : null;
  },
  /** Companies the contacts work at, with the relationship there. */
  async companies(query: CompanyQuery) {
    const { data } = await getContactsCompanies({ ...options(), query });
    return { companies: data.data, total: data.meta.pagination.total };
  },
  async companyLists() {
    return (await getContactsCompanyLists({ ...options() })).data.data;
  },
  async createCompanyList(
    body: NonNullable<PostContactsCompanyListsData["body"]>,
  ) {
    return (await postContactsCompanyLists({ ...options(), body })).data.data;
  },
  async updateCompanyList(
    listId: string,
    body: NonNullable<PatchContactsCompanyListsByListIdData["body"]>,
  ) {
    return (
      await patchContactsCompanyListsByListId({
        ...options(),
        path: { listId },
        body,
      })
    ).data.data;
  },
  async deleteCompanyList(listId: string) {
    await deleteContactsCompanyListsByListId({
      ...options(),
      path: { listId },
    });
  },
  async changeCompanyMembers(
    listId: string,
    change: { add?: string[]; remove?: string[] },
  ) {
    return (
      await postContactsCompanyListsByListIdMembers({
        ...options(),
        path: { listId },
        body: { add: change.add ?? [], remove: change.remove ?? [] },
      })
    ).data.data;
  },
  async company(companyId: string) {
    return (
      await getContactsCompaniesByCompanyId({
        ...options(),
        path: { companyId },
      })
    ).data.data;
  },
  async updateCompany(
    companyId: string,
    body: NonNullable<PatchContactsCompaniesByCompanyIdData["body"]>,
  ) {
    return (
      await patchContactsCompaniesByCompanyId({
        ...options(),
        path: { companyId },
        body,
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
  async duplicates(query: { contactId?: string; limit?: number } = {}) {
    return (await getContactsDuplicates({ ...options(), query })).data.data;
  },
  /** These contacts are different people; duplicates stop grouping them. */
  async notDuplicates(contactIds: string[]) {
    await postContactsDuplicatesDismiss({ ...options(), body: { contactIds } });
  },
  async merge(winnerId: string, loserIds: string[]) {
    return (
      await postContactsMerge({ ...options(), body: { winnerId, loserIds } })
    ).data.data;
  },
  async setStage(contactIds: string[], stage: ContactStage) {
    return (
      await postContactsStage({ ...options(), body: { contactIds, stage } })
    ).data.data;
  },
  async undoStage(
    contacts: NonNullable<PostContactsStageUndoData["body"]>["contacts"],
  ) {
    return (await postContactsStageUndo({ ...options(), body: { contacts } }))
      .data.data;
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
