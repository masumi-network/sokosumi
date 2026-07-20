import { getTranslations } from "next-intl/server";
import { CoreAuthReadRetry } from "@/components/auth/core-auth-read-retry";
import { getSession, listUserAccounts } from "@/lib/auth/auth.server";
import { AccountProvider } from "@/lib/auth/types";

import { OAuthAuthorizedClients } from "./authorized-clients";
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
    <SocialAccounts
      socialAccounts={accountsResult.value.filter(
        (account) => account.providerId !== AccountProvider.CREDENTIAL,
      )}
    />
  );

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-4xl space-y-8 px-4">
        <div className="space-y-6">
          {socialAccountsSection}
          <OAuthAuthorizedClients />
        </div>
      </div>
    </div>
  );
}
