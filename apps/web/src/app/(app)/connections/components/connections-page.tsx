import { type Account } from "@sokosumi/utils";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { CoreAuthReadRetry } from "@/components/auth/core-auth-read-retry";
import { getSession, listUserAccounts } from "@/lib/auth/auth.server";
import { AccountProvider } from "@/lib/auth/types";

import { ApiKeysSection } from "./api-keys";
import { OAuthAuthorizedClients } from "./authorized-clients";
import { ConnectionsTabs } from "./connections-tabs";
import { McpActiveKeyView } from "./mcp-active-key-view";
import { SocialAccounts } from "./social-accounts";

export async function ConnectionsPage() {
  const t = await getTranslations("App.Account.SocialAccounts");
  const [accountsResult, session] = await Promise.all([
    listUserAccounts(),
    getSession(),
  ]);

  if (!session?.user) {
    return null;
  }

  if (accountsResult.isErr()) {
    return (
      <div className="min-h-full w-full">
        <div className="mx-auto max-w-4xl space-y-8 px-4">
          <CoreAuthReadRetry
            description={t("loadError")}
            retryLabel={t("retry")}
            title={t("loadErrorTitle")}
          />
        </div>
      </div>
    );
  }

  const accounts: Account[] = accountsResult.value;

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
