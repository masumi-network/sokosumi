import { runEnterpriseContractSchedulerPass } from "@sokosumi/database/helpers";
import type { Hono } from "hono";

import { grantEnterpriseCredits } from "@/lib/credits/grant";
import { networkUsesSharedSchema } from "@/lib/db/network-scope";
import { serializableTransaction } from "@/lib/db/transaction";

import { handleSyncRequest } from "../handler.js";

const ENTERPRISE_CONTRACTS_RENEWAL_SYNC_LOCK_KEY =
  "enterprise-contracts-renewal-sync";

export default function mount(app: Hono) {
  app.get("/enterprise-contracts-renewal", async (c) => {
    return await handleSyncRequest(
      c,
      ENTERPRISE_CONTRACTS_RENEWAL_SYNC_LOCK_KEY,
      async (context) => {
        // The period amount read here must serialize with admin credit edits.
        const result = await serializableTransaction(
          (tx) =>
            networkUsesSharedSchema()
              ? runEnterpriseContractSchedulerPass(
                  tx,
                  grantEnterpriseCredits(context.scope, tx),
                )
              : runEnterpriseContractSchedulerPass(
                  tx,
                  grantEnterpriseCredits(context.scope, tx),
                  undefined,
                  { splitSql: true },
                ),
          "Enterprise contract changed concurrently; retry renewal",
        );

        context.log.set({
          result: {
            catchUpGranted: result.catchUpGranted,
            completedContracts: result.completedContracts,
            expiredPeriods: result.expiredPeriods,
            preCreated: result.preCreated,
          },
        });
      },
      // Enterprise credits are Mainnet's.
      { errorDetail: "cause", network: "mainnet" },
    );
  });
}
