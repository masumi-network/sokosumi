import type { Hono } from "hono";

import { ensureFirstPartyCliOAuthClient } from "@/helpers/first-party-cli-oauth-client";
import prisma from "@/lib/db/prisma";

import { handleSyncRequest } from "../handler.js";

export const FIRST_PARTY_OAUTH_CLIENTS_SYNC_LOCK_KEY =
  "first-party-oauth-clients-sync";

export default function mount(app: Hono) {
  app.get("/first-party-oauth-clients", async (c) => {
    return await handleSyncRequest(
      c,
      FIRST_PARTY_OAUTH_CLIENTS_SYNC_LOCK_KEY,
      async () => {
        const client = await ensureFirstPartyCliOAuthClient(prisma);
        console.info(
          "[sync/first-party-oauth-clients] CLI OAuth client ready",
          {
            clientId: client.clientId,
          },
        );
      },
    );
  });
}
