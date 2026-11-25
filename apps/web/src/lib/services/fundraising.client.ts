import {
  getFundraising,
  getFundraisingAccess,
  getFundraisingProspectsByContactIdPaths,
  getFundraisingSuggestions,
  type PatchFundraisingProspectsByContactIdData,
  type PostFundraisingFindData,
  patchFundraisingProspectsByContactId,
  postFundraisingFind,
  postFundraisingProspectsByContactIdResearch,
  postFundraisingSuggestionsAdd,
  postFundraisingSuggestionsDismiss,
} from "@sokosumi/core-client";
import { getBrowserCoreClient } from "@/lib/clients/core.browser.client";

export type FundraisingProspectPatch = NonNullable<
  PatchFundraisingProspectsByContactIdData["body"]
>;
export type FundraisingFindInput = NonNullable<PostFundraisingFindData["body"]>;

function options() {
  return { client: getBrowserCoreClient(), throwOnError: true as const };
}

/** The raise's reads and writes, from the browser through Core. */
export const fundraisingService = {
  async access() {
    return (await getFundraisingAccess({ ...options() })).data.data.enabled;
  },
  async pipeline() {
    return (await getFundraising({ ...options() })).data.data;
  },
  async suggestions() {
    return (await getFundraisingSuggestions({ ...options() })).data.data;
  },
  /** One Exa search; the result says what it cost and what the month stands at. */
  async find(body: FundraisingFindInput) {
    return (await postFundraisingFind({ ...options(), body })).data.data;
  },
  async addSuggestions(ids: string[]) {
    return (
      await postFundraisingSuggestionsAdd({ ...options(), body: { ids } })
    ).data.data;
  },
  async dismissSuggestions(ids: string[]) {
    return (
      await postFundraisingSuggestionsDismiss({ ...options(), body: { ids } })
    ).data.data;
  },
  async paths(contactId: string) {
    return (
      await getFundraisingProspectsByContactIdPaths({
        ...options(),
        path: { contactId },
      })
    ).data.data;
  },
  /** One Exa run for the investor's portfolio; answers with the new paths. */
  async researchPortfolio(contactId: string) {
    return (
      await postFundraisingProspectsByContactIdResearch({
        ...options(),
        path: { contactId },
      })
    ).data.data;
  },
  async updateProspect(contactId: string, body: FundraisingProspectPatch) {
    return (
      await patchFundraisingProspectsByContactId({
        ...options(),
        path: { contactId },
        body,
      })
    ).data.data;
  },
};
