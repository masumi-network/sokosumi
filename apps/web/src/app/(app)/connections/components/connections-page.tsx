import { headers } from "next/headers";
import { Suspense } from "react";
import { type Account, auth } from "@/lib/auth/auth";
import { getSession } from "@/lib/auth/auth.server";
import { AccountProvider } from "@/lib/auth/types";

import { ApiKeysSection } from "./api-keys";
import { OAuthAuthorizedClients } from "./authorized-clients";
import { ConnectionsTabs } from "./connections-tabs";
import { McpActiveKeyView } from "./mcp-active-key-view";
import { SocialAccounts } from "./social-accounts";

export async function ConnectionsPage() {
  const requestHeaders = await headers();
  const [accountsData, session] = await Promise.all([
    auth.api.listUserAccounts({
      headers: requestHeaders,
    }),
    getSession(),
  ]);
  const accounts: Account[] = accountsData;

  if (!session?.user) {
    return null;
  }

  const socialAccounts = accounts.filter(
    (account) => account.providerId !== AccountProvider.CREDENTIAL,
  );

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-4xl space-y-8 px-4">
        <div className="space-y-6">
          <SocialAccounts socialAccounts={socialAccounts} />
          <ConnectionsTabs
            connectedAppsContent={<OAuthAuthorizedClients />}
            apiKeysContent={<ApiKeysSection />}
            mcpContent={
              <Suspense fallback={null}>
                <McpActiveKeyView />
              </Suspense>
            }
          />
        </div>
      </div>
    </div>
  );
}
