import {
  setMySokoBotAvatarCode as coreSetMySokoBotAvatarCode,
  setSokoBotAvatarCode as coreSetSokoBotAvatarCode,
} from "@sokosumi/core-client";
import { executeCoreOperation, type GetCoreClient } from "./core.request";

export function createSokoBotAvatarClient(getClient: GetCoreClient) {
  /** Your own bot, or a shared one by id. */
  async function setSokoBotAvatarCode(code: string, sokoBotId?: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        sokoBotId
          ? coreSetSokoBotAvatarCode({
              client,
              path: { sokoBotId },
              body: { code },
            })
          : coreSetMySokoBotAvatarCode({ client, body: { code } }),
      "Failed to update Soko Bot avatar look",
    );
  }

  return {
    setSokoBotAvatarCode,
  };
}
