import "server-only";

import { coreClient } from "@/lib/clients/core.client";
import type { Vendor } from "@/lib/clients/generated/core";

export const vendorService = (() => {
  async function listVendors(): Promise<Vendor[]> {
    const { data } = await coreClient.listVendors();
    return data;
  }

  return {
    listVendors,
  };
})();
