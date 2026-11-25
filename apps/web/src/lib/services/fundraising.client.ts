import {
  getFundraising,
  getFundraisingAccess,
  type PatchFundraisingProspectsByContactIdData,
  patchFundraisingProspectsByContactId,
} from "@sokosumi/core-client";
import { getBrowserCoreClient } from "@/lib/clients/core.browser.client";

export type FundraisingProspectPatch = NonNullable<
  PatchFundraisingProspectsByContactIdData["body"]
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
