import {
  MemberRole,
  type StripeCustomerBillingDetails,
  type UserDeletionEvaluation,
} from "@sokosumi/core-client";
import { getUserMetadata } from "@sokosumi/utils";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { type ReactNode, Suspense } from "react";
import { CoreAuthReadRetry } from "@/components/auth/core-auth-read-retry";
import { BillingPortalErrorToast } from "@/components/billing/billing-portal-error-toast";
import DefaultLoading from "@/components/default-loading";
import { HOLDER_CLASS } from "@/components/ui/holder-surface";
import { AUTO_DETECT_VALUE } from "@/i18n/locales";
import { parseTimeFormat, TIME_FORMAT_COOKIE_NAME } from "@/i18n/time-format";
import { getSession, listUserAccounts } from "@/lib/auth/auth.server";
import { coreClient } from "@/lib/clients/core.client";
import { toDesignMdProfileValue } from "@/lib/helpers/design-md-profile";
import { designMdService } from "@/lib/services/design-md.service";
import { userService } from "@/lib/services/user.service";
import { cn } from "@/lib/utils";

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

  // No read here needs another's answer, so all of them start together. The
  // two that may fail on their own keep their error for the section they feed.
  const [
    t,
    tBilling,
    tDelete,
    accountsResult,
    session,
    cookieStore,
    billingRead,
    workspaceAccess,
    members,
    deletionRead,
  ] = await Promise.all([
    getTranslations("App.Account.LinkedAccounts"),
    getTranslations("App.Account.BillingDetails"),
    getTranslations("App.Account.Delete"),
    listUserAccounts(),
    getSession(),
    cookies(),
    coreClient.getMyBillingDetails().then(
      (response) => ({ data: response.data }),
      (error: unknown) => ({ error }),
    ),
    userService.getWorkspaceAccess(),
    userService.getMyMembersWithOrganizations(),
    coreClient.getMyDeletion().then(
      (response) => ({ data: response.data }),
      (error: unknown) => ({ error }),
    ),
  ]);
  const initialTimeFormat =
    parseTimeFormat(cookieStore.get(TIME_FORMAT_COOKIE_NAME)?.value) ??
    AUTO_DETECT_VALUE;

  let billingDetails: StripeCustomerBillingDetails | undefined;
  let billingDetailsLoadError: ReactNode | undefined;

  if ("data" in billingRead) {
    billingDetails = billingRead.data;
  } else {
    console.error("Failed to load billing details", billingRead.error);
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

  let deletionBlockers: UserDeletionEvaluation["blockers"] = [];
  let deletionPreflightFailed = false;
  let deletionPreflightLoadError: ReactNode | undefined;
  if ("data" in deletionRead) {
    deletionBlockers = deletionRead.data.blockers;
  } else {
    console.error(
      "Failed to load account deletion blockers",
      deletionRead.error,
    );
    deletionPreflightFailed = true;
    deletionPreflightLoadError = (
      <CoreAuthReadRetry
        description={tDelete("preflightError")}
        retryLabel={tDelete("retry")}
        title={tDelete("loadErrorTitle")}
      />
    );
  }

  return (
    <div className="content-in min-h-full w-full">
      <BillingPortalErrorToast generalMessage={tBilling("Errors.general")} />
      <div className={cn(HOLDER_CLASS, "p-3")}>
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
          userName={session?.user.name}
          userEmail={session?.user.email}
          userFirstName={session?.user.firstName}
          userLastName={session?.user.lastName}
          userImage={session?.user.image}
          userLogo={session?.user.logo}
          userMetadata={session?.user.metadata}
          hasPersonalWorkspace={workspaceAccess?.hasPersonalWorkspace ?? false}
          hasOrganizationMembership={
            workspaceAccess?.hasOrganizationMembership ?? members.length > 0
          }
          fallbackOrganizationId={members[0]?.organization.id ?? null}
          currentOrganizationId={session?.session.activeOrganizationId ?? null}
          deletionBlockers={deletionBlockers}
          deletionPreflightFailed={deletionPreflightFailed}
          deletionPreflightLoadError={deletionPreflightLoadError}
          ownedOrganizationSlug={
            members.find((member) => member.role === MemberRole.OWNER)
              ?.organization.slug ?? null
          }
          initialTimeFormat={initialTimeFormat}
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
