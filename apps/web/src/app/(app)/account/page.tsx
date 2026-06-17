import { getUserMetadata } from "@sokosumi/utils";
import { getTranslations } from "next-intl/server";
import { CoreAuthReadRetry } from "@/components/auth/core-auth-read-retry";
import { getSession, listUserAccounts } from "@/lib/auth/auth.server";
import { toDesignMdProfileValue } from "@/lib/helpers/design-md-profile";
import { designMdService } from "@/lib/services/design-md.service";

import { AccountSettings } from "./components/account-settings";

export default async function Page() {
  const t = await getTranslations("App.Account.LinkedAccounts");
  const [accountsResult, session] = await Promise.all([
    listUserAccounts(),
    getSession(),
  ]);
  const userMetadata = getUserMetadata(session?.user.metadata);
  const designMdValue = toDesignMdProfileValue(
    userMetadata,
    designMdService.getDesignMdPreviewUrl,
  );

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-4xl px-4">
        <AccountSettings
          accounts={accountsResult.isOk() ? accountsResult.value : []}
          designMdValue={designMdValue}
          linkedAccountsLoadError={
            accountsResult.isErr() ? (
              <CoreAuthReadRetry
                description={t("loadError")}
                retryLabel={t("retry")}
                title={t("loadErrorTitle")}
              />
            ) : undefined
          }
          notificationsOptIn={session?.user.notificationsOptIn ?? true}
          userLogo={session?.user.logo}
          userMetadata={session?.user.metadata}
          marketingOptIn={session?.user.marketingOptIn ?? false}
        />
      </div>
    </div>
  );
}
