import { runEnterpriseContractSchedulerPass } from "@sokosumi/database/helpers";
import type { Hono } from "hono";

import { serializableTransaction } from "@/lib/db/transaction";

import { handleSyncRequest } from "../handler.js";

const ENTERPRISE_CONTRACTS_RENEWAL_SYNC_LOCK_KEY =
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
        // The period amount read here must serialize with admin credit edits.
        const result = await serializableTransaction(
          (tx) => runEnterpriseContractSchedulerPass(tx),
          "Enterprise contract changed concurrently; retry renewal",
        );

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
