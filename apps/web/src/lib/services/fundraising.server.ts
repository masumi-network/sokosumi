import "server-only";

import {
  type FundraisingPipeline,
  getFundraising,
} from "@sokosumi/core-client";
import { createCoreGeneratedClient } from "@/lib/clients/core.client";

/** The raise, or null when this organization has no Fundraising. */
export async function readFundraisingPipeline(): Promise<FundraisingPipeline | null> {
  const { data, response } = await getFundraising({
    client: await createCoreGeneratedClient(),
  });
  if (response?.status === 404 || !data) return null;
  return data.data;
}
