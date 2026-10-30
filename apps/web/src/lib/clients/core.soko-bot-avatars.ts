import {
  type CreateSokoBotAvatarDraftRequest,
  claimMySokoBotAvatar as coreClaimMySokoBotAvatar,
  createMySokoBotAvatarDraft as coreCreateMySokoBotAvatarDraft,
  createSokoBotAvatarDraft as coreCreateSokoBotAvatarDraft,
  discardMySokoBotAvatarDrafts as coreDiscardMySokoBotAvatarDrafts,
  discardSokoBotAvatarDrafts as coreDiscardSokoBotAvatarDrafts,
  getMySokoBotAvatarStudio as coreGetMySokoBotAvatarStudio,
  getSokoBotAvatarStudio as coreGetSokoBotAvatarStudio,
  keepMySokoBotAvatarDraft as coreKeepMySokoBotAvatarDraft,
  keepSokoBotAvatarDraft as coreKeepSokoBotAvatarDraft,
  listSokoBotAvatars as coreListSokoBotAvatars,
  regenerateMySokoBotAvatarState as coreRegenerateMySokoBotAvatarState,
  regenerateSokoBotAvatarState as coreRegenerateSokoBotAvatarState,
  topUpSokoBotAvatars as coreTopUpSokoBotAvatars,
  type SokoBotAvatarState,
} from "@sokosumi/core-client";
import { executeCoreOperation, type GetCoreClient } from "./core.request";

export function createSokoBotAvatarClient(getClient: GetCoreClient) {
  async function listSokoBotAvatars(query?: {
    take?: number;
    exclude?: string;
  }) {
    return executeCoreOperation(
      getClient,
      (client) => coreListSokoBotAvatars({ client, query, cache: "no-store" }),
      "Failed to fetch Soko Bot avatars",
    );
  }

  async function topUpSokoBotAvatars(body: {
    take?: number;
    excludeIds?: string[];
  }) {
    return executeCoreOperation(
      getClient,
      (client) => coreTopUpSokoBotAvatars({ client, body }),
      "Failed to fetch Soko Bot avatars",
    );
  }

  async function claimMySokoBotAvatar(body: { avatarId: string }) {
    return executeCoreOperation(
      getClient,
      (client) => coreClaimMySokoBotAvatar({ client, body }),
      "Failed to update Soko Bot avatar",
    );
  }

  /** The avatar studio of the caller's own bot, or of the shared bot `sokoBotId`. */
  async function getSokoBotAvatarStudio(sokoBotId?: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        sokoBotId
          ? coreGetSokoBotAvatarStudio({
              client,
              path: { sokoBotId },
              cache: "no-store",
            })
          : coreGetMySokoBotAvatarStudio({ client, cache: "no-store" }),
      "Failed to fetch the avatar studio",
    );
  }

  async function createSokoBotAvatarDraft(
    body: CreateSokoBotAvatarDraftRequest,
    sokoBotId?: string,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        sokoBotId
          ? coreCreateSokoBotAvatarDraft({
              client,
              body,
              path: { sokoBotId },
            })
          : coreCreateMySokoBotAvatarDraft({ client, body }),
      "Failed to draft a Soko Bot avatar",
    );
  }

  async function keepSokoBotAvatarDraft(draftId: string, sokoBotId?: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        sokoBotId
          ? coreKeepSokoBotAvatarDraft({
              client,
              path: { sokoBotId, draftId },
            })
          : coreKeepMySokoBotAvatarDraft({ client, path: { draftId } }),
      "Failed to keep the Soko Bot avatar",
    );
  }

  /** Clears every open draft, so the bot's kept look is all that is left. */
  async function discardSokoBotAvatarDrafts(sokoBotId?: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        sokoBotId
          ? coreDiscardSokoBotAvatarDrafts({ client, path: { sokoBotId } })
          : coreDiscardMySokoBotAvatarDrafts({ client }),
      "Failed to discard the Soko Bot avatar drafts",
    );
  }

  /** Redoes one state's animation of the kept look. */
  async function regenerateSokoBotAvatarState(
    state: SokoBotAvatarState,
    sokoBotId?: string,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        sokoBotId
          ? coreRegenerateSokoBotAvatarState({
              client,
              path: { sokoBotId, state },
            })
          : coreRegenerateMySokoBotAvatarState({ client, path: { state } }),
      "Failed to redo the Soko Bot avatar animation",
    );
  }

  return {
    listSokoBotAvatars,
    topUpSokoBotAvatars,
    claimMySokoBotAvatar,
    getSokoBotAvatarStudio,
    createSokoBotAvatarDraft,
    keepSokoBotAvatarDraft,
    discardSokoBotAvatarDrafts,
    regenerateSokoBotAvatarState,
  };
}
