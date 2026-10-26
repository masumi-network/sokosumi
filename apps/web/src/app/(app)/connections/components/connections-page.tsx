import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { CoreAuthReadRetry } from "@/components/auth/core-auth-read-retry";
import { HOLDER_CLASS } from "@/components/ui/holder-surface";
import { getSession, listUserAccounts } from "@/lib/auth/auth.server";
import { cn } from "@/lib/utils";

import { OAuthAuthorizedClients } from "./authorized-clients";
import { ConnectionsTabs } from "./connections-tabs";
import { McpActiveKeyView } from "./mcp-active-key-view";
import { SocialAccounts } from "./social-accounts";

export async function ConnectionsPage() {
  const t = await getTranslations("App.Account.SocialAccounts");
  const session = await getSession();

  if (!session?.user) {
    return null;
  }

  const accountsResult = await listUserAccounts();

  const socialAccountsSection = accountsResult.isErr() ? (
    <CoreAuthReadRetry
      description={t("loadError")}
      retryLabel={t("retry")}
      title={t("loadErrorTitle")}
    />
  ) : (
    <SocialAccounts accounts={accountsResult.value} />
  );

  return (
    <div className="min-h-full w-full">
      <div className={cn(HOLDER_CLASS, "space-y-6 p-3")}>
        <div className="space-y-6">
          <section className="space-y-3" data-testid="connections-sign-in">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">{t("title")}</h2>
              <p className="text-muted-foreground text-sm">
                {t("description")}
              </p>
            </div>
            {socialAccountsSection}
          </section>
          <ConnectionsTabs
            connectedAppsContent={<OAuthAuthorizedClients />}
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
