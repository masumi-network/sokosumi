import { createClient } from "@/lib/clients/generated/core/client";
import {
  getUsersByIdPreferences,
  patchUsersByIdPreferences,
} from "@/lib/clients/generated/core/sdk.gen";
import type {
  GetUsersByIdPreferencesResponse,
  PatchUsersByIdPreferencesData,
  PatchUsersByIdPreferencesResponse,
} from "@/lib/clients/generated/core/types.gen";
import { getBrowserCoreApiBaseUrl } from "@/lib/clients/utils/core-api-base-url.browser";

import { executeCoreOperation } from "./core.request";

/** Core resolves `me` to the authenticated session user. */
const CURRENT_USER_PATH_ID = "me";

let preferencesGeneratedClient: ReturnType<typeof createClient> | undefined;

/**
 * Own generated client rather than the one in `core.browser.client`, which
 * pulls the whole `core.shared` operation map into the bundle. Same reason
 * `core.notifications.browser.client` keeps its own.
 */
function getPreferencesGeneratedClient() {
  preferencesGeneratedClient ??= createClient({
    baseUrl: getBrowserCoreApiBaseUrl(),
    credentials: "include",
  });

  return preferencesGeneratedClient;
}

export const preferencesBrowserClient = {
  /** Read the session user's preferences, including the account-wide push opt-in. */
  async getMyPreferences(): Promise<GetUsersByIdPreferencesResponse> {
    return executeCoreOperation(
      getPreferencesGeneratedClient,
      (client) =>
        getUsersByIdPreferences({
          client,
          path: { id: CURRENT_USER_PATH_ID },
          cache: "no-store",
        }),
      "Failed to read user preferences",
    );
  },

  /**
   * Patch the session user's preferences and return the full preferences DTO.
   *
   * Core patches only the keys present in the body, so a caller that sends
   * `pushOptIn` alone leaves the email preferences untouched.
   */
  async patchMyPreferences(
    body: NonNullable<PatchUsersByIdPreferencesData["body"]>,
  ): Promise<PatchUsersByIdPreferencesResponse> {
    return executeCoreOperation(
      getPreferencesGeneratedClient,
      (client) =>
        patchUsersByIdPreferences({
          client,
          path: { id: CURRENT_USER_PATH_ID },
          body,
        }),
      "Failed to update user preferences",
    );
  },
};
