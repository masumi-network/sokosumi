import type { Hono } from "hono";

import { getEnv } from "@/config/env";
import { NETWORKS } from "@/lib/network";
import { sourceImportSyncService } from "@/services/source-import-sync.service";

import { handleSyncRequest } from "../handler.js";

const SOURCE_IMPORT_SYNC_LOCK_KEY = "source-import-sync";

export default function mount(app: Hono) {
  for (const network of NETWORKS) {
    const path =
      network === "mainnet" ? "/source-import" : "/preprod/source-import";
    app.get(path, (c) =>
      handleSyncRequest(
        c,
        SOURCE_IMPORT_SYNC_LOCK_KEY,
        async (context) => {
          const pendingBlobs =
            await sourceImportSyncService.importPendingResultBlobs({
              ...context,
              write: context.lease.write,
            });
          context.log.set({ result: { pendingBlobs } });
        },
        {
          network,
          errorDetail: "safe-fields",
          enabled: () =>
            network === "mainnet" || Boolean(getEnv().BLOB_READ_WRITE_TOKEN),
        },
      ),
    );
  }
}
