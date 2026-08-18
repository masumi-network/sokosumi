import type { Account } from "@sokosumi/utils";
import type { ReactNode } from "react";
import type { DesignMdProfileValue } from "@/components/design-md";
import { AccountProvider } from "@/lib/auth/types";
import type { StripeCustomerBillingDetails } from "@/lib/clients/generated/core";
import { AccountBillingDetails } from "./account-billing-details";
import { AccountCoworkerAccess } from "./account-coworker-access";
import { AccountVendorGrants } from "./account-vendor-grants";
import { BrandProfileSection } from "./brand-profile-section";

import { DeleteAccountForm } from "./delete-account-form";
import { DeletePersonalWorkspaceForm } from "./delete-personal-workspace-form";
import { EmailForm } from "./email-form";
import { EmailPreferences } from "./email-preferences";
import { NameForm } from "./name-form";
import { NewPasswordForm } from "./new-password-form";
import { PasskeySettings } from "./passkey-settings";
import { PasswordForm } from "./password-form";
import { PreferencesSection } from "./preferences-section";
import { ProfileImageSection } from "./profile-image-section";

interface AccountSettingsProps {
  accounts: Account[];
  billingDetails?: StripeCustomerBillingDetails;
  billingDetailsLoadError?: ReactNode;
  designMdValue?: DesignMdProfileValue;
  credentialAccountsLoadError?: ReactNode;
  notificationsOptIn: boolean;
  userImage?: null | string;
  userLogo?: null | string;
  userMetadata?: null | string;
  marketingOptIn: boolean;
  hasPersonalWorkspace?: boolean;
  hasOrganizationMembership?: boolean;
  fallbackOrganizationId?: string | null;
  currentOrganizationId?: string | null;
}

export function AccountSettings({
  accounts,
  billingDetails,
  billingDetailsLoadError,
  designMdValue,
  credentialAccountsLoadError,
  notificationsOptIn,
  userImage,
  userLogo,
  userMetadata,
  marketingOptIn,
  hasPersonalWorkspace = false,
  hasOrganizationMembership = false,
  fallbackOrganizationId = null,
  currentOrganizationId = null,
}: AccountSettingsProps) {
  const hasCredentialAccount = accounts.some(
    (account) => account.providerId === AccountProvider.CREDENTIAL,
  );

  return (
    <div className="w-full space-y-8">
      <div className="grid w-full grid-cols-1 gap-6 md:grid-cols-2">
        <div className="md:col-span-2">
          <ProfileImageSection userImage={userImage} />
        </div>
        <NameForm />
        <EmailForm />
        <div className="md:col-span-2">
          {credentialAccountsLoadError ? (
            credentialAccountsLoadError
          ) : hasCredentialAccount ? (
            <PasswordForm />
          ) : (
            <NewPasswordForm />
          )}
        </div>
        <div className="md:col-span-2">
          <PasskeySettings />
        </div>
      </div>

      <div className="border-t pt-8">
        <BrandProfileSection
          designMdValue={designMdValue}
          logo={userLogo}
          metadata={userMetadata}
        />
      </div>

      <div className="border-t pt-8">
        <AccountVendorGrants />
      </div>

      <div className="border-t pt-8">
        <AccountCoworkerAccess />
      </div>

      <div className="border-t pt-8">
        <PreferencesSection />
      </div>

      <div className="border-t pt-8">
        <EmailPreferences
          notificationsOptIn={notificationsOptIn}
          marketingOptIn={marketingOptIn}
        />
      </div>

      <div className="border-t pt-8">
        {billingDetailsLoadError ? (
          billingDetailsLoadError
        ) : billingDetails ? (
          <AccountBillingDetails billingDetails={billingDetails} />
        ) : null}
      </div>

      {hasPersonalWorkspace ? (
        <div className="border-t pt-8">
          <div className="mx-auto w-full">
            <DeletePersonalWorkspaceForm
              hasOrganizationMembership={hasOrganizationMembership}
              fallbackOrganizationId={fallbackOrganizationId}
              currentOrganizationId={currentOrganizationId}
            />
          </div>
        </div>
      ) : null}

      <div className="border-t pt-8">
        <div className="mx-auto w-full">
          <DeleteAccountForm />
        </div>
      </div>
    </div>
  );
}
