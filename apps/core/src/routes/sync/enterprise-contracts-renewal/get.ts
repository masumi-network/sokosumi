import type { Hono } from "hono";

import { enterpriseContractSyncService } from "@/services/enterprise-contract-sync.service";

import { handleSyncRequest } from "../handler.js";

export const ENTERPRISE_CONTRACTS_RENEWAL_SYNC_LOCK_KEY =
  "enterprise-contracts-renewal-sync";

export default function mount(app: Hono) {
  app.get("/enterprise-contracts-renewal", async (c) => {
    return await handleSyncRequest(
      c,
      ENTERPRISE_CONTRACTS_RENEWAL_SYNC_LOCK_KEY,
      async () => {
        console.info(
          "[sync/enterprise-contracts-renewal] Starting enterprise contract renewal",
        );
        const startedAt = Date.now();
        const result = await enterpriseContractSyncService.runRenewalPass();

        console.info("[sync/enterprise-contracts-renewal] Completed sync", {
          catchUpGranted: result.catchUpGranted,
          completedContracts: result.completedContracts,
          durationMs: Date.now() - startedAt,
          expiredPeriods: result.expiredPeriods,
          preCreated: result.preCreated,
        });
      },
    );
  });
}
