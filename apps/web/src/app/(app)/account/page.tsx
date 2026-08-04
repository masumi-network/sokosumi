import { getUserMetadata } from "@sokosumi/utils";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { type ReactNode, Suspense } from "react";
import { CoreAuthReadRetry } from "@/components/auth/core-auth-read-retry";
import { BillingPortalErrorToast } from "@/components/billing/billing-portal-error-toast";
import DefaultLoading from "@/components/default-loading";
import { getSession, listUserAccounts } from "@/lib/auth/auth.server";
import { coreClient } from "@/lib/clients/core.client";
import type { StripeCustomerBillingDetails } from "@/lib/clients/generated/core";
import { toDesignMdProfileValue } from "@/lib/helpers/design-md-profile";
import { designMdService } from "@/lib/services/design-md.service";

import { AccountSettings } from "./components/account-settings";

function AccountPageFallback() {
  return (
    <div className="flex items-center justify-center gap-16 md:p-8">
      <DefaultLoading />
    </div>
  );
}

async function AccountPageContent() {
  // Defer before any cookies()/headers()-bound work so PPR shell probing does
  // not soft-reject dynamic APIs while filling this Suspense hole.
  await connection();

  const t = await getTranslations("App.Account.LinkedAccounts");
  const tBilling = await getTranslations("App.Account.BillingDetails");
  const [accountsResult, session] = await Promise.all([
    listUserAccounts(),
    getSession(),
  ]);

  let billingDetails: StripeCustomerBillingDetails | undefined;
  let billingDetailsLoadError: ReactNode | undefined;

  try {
    const billingDetailsResponse = await coreClient.getMyBillingDetails();
    billingDetails = billingDetailsResponse.data;
  } catch (error) {
    console.error("Failed to load billing details", error);
    billingDetailsLoadError = (
      <CoreAuthReadRetry
        description={tBilling("loadError")}
        retryLabel={tBilling("retry")}
        title={tBilling("loadErrorTitle")}
      />
    );
  }

  const userMetadata = getUserMetadata(session?.user.metadata);
  const designMdValue = toDesignMdProfileValue(
    userMetadata,
    designMdService.getDesignMdPreviewUrl,
  );

  return (
    <div className="min-h-full w-full">
      <BillingPortalErrorToast generalMessage={tBilling("Errors.general")} />
      <div className="mx-auto max-w-4xl px-4">
        <AccountSettings
          accounts={accountsResult.isOk() ? accountsResult.value : []}
          billingDetails={billingDetails}
          billingDetailsLoadError={billingDetailsLoadError}
          designMdValue={designMdValue}
          credentialAccountsLoadError={
            accountsResult.isErr() ? (
              <CoreAuthReadRetry
                description={t("loadError")}
                retryLabel={t("retry")}
                title={t("loadErrorTitle")}
              />
            ) : undefined
          }
          notificationsOptIn={session?.user.notificationsOptIn ?? true}
          userImage={session?.user.image}
          userLogo={session?.user.logo}
          userMetadata={session?.user.metadata}
          marketingOptIn={session?.user.marketingOptIn ?? false}
        />
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<AccountPageFallback />}>
      <AccountPageContent />
    </Suspense>
  );
}
