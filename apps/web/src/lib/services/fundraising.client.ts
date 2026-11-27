import {
  getFundraising,
  getFundraisingAccess,
  getFundraisingProspectsByContactIdPaths,
  getFundraisingSuggestions,
  type PatchFundraisingProspectsByContactIdData,
  type PostFundraisingFindData,
  type PostFundraisingProspectsByContactIdDraftData,
  type PostFundraisingProspectsByContactIdIntroAskData,
  patchFundraisingProspectsByContactId,
  postFundraisingFind,
  postFundraisingProspectsByContactIdDraft,
  postFundraisingProspectsByContactIdIntroAsk,
  postFundraisingProspectsByContactIdResearch,
  postFundraisingSuggestionsAdd,
  postFundraisingSuggestionsDismiss,
} from "@sokosumi/core-client";
import { getBrowserCoreClient } from "@/lib/clients/core.browser.client";

export type FundraisingProspectPatch = NonNullable<
  PatchFundraisingProspectsByContactIdData["body"]
>;
export type FundraisingFindInput = NonNullable<PostFundraisingFindData["body"]>;
export type FundraisingDraftInput = NonNullable<
  PostFundraisingProspectsByContactIdDraftData["body"]
>;
export type FundraisingIntroAskInput = NonNullable<
  PostFundraisingProspectsByContactIdIntroAskData["body"]
>;

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
  /** Writes a mail and puts it in the caller's own mailbox as a draft; never sends. */
  async draft(contactId: string, body: FundraisingDraftInput) {
    return (
      await postFundraisingProspectsByContactIdDraft({
        ...options(),
        path: { contactId },
        body,
      })
    ).data.data;
  },
  /** Two drafts in the caller's mailbox: the ask to the connector and the forwardable note; never sends. */
  async introAsk(contactId: string, body: FundraisingIntroAskInput) {
    return (
      await postFundraisingProspectsByContactIdIntroAsk({
        ...options(),
        path: { contactId },
        body,
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
