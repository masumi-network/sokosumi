import type { Account } from "@sokosumi/utils";
import type { ReactNode } from "react";
import type { DesignMdProfileValue } from "@/components/design-md";
import { AccountProvider } from "@/lib/auth/types";

import { BrandProfileSection } from "./brand-profile-section";
import { DeleteAccountForm } from "./delete-account-form";
import { EmailForm } from "./email-form";
import { EmailPreferences } from "./email-preferences";
import { NameForm } from "./name-form";
import { NewPasswordForm } from "./new-password-form";
import { PasskeySettings } from "./passkey-settings";
import { PasswordForm } from "./password-form";
import { PreferencesSection } from "./preferences-section";

interface AccountSettingsProps {
  accounts: Account[];
  designMdValue?: DesignMdProfileValue;
  linkedAccountsLoadError?: ReactNode;
  notificationsOptIn: boolean;
  userLogo?: null | string;
  userMetadata?: null | string;
  marketingOptIn: boolean;
}

export function AccountSettings({
  accounts,
  designMdValue,
  linkedAccountsLoadError,
  notificationsOptIn,
  userLogo,
  userMetadata,
  marketingOptIn,
}: AccountSettingsProps) {
  const hasCredentialAccount = accounts.some(
    (account) => account.providerId === AccountProvider.CREDENTIAL,
  );

  return (
    <div className="w-full space-y-8">
      <div className="grid w-full grid-cols-1 gap-6 md:grid-cols-2">
        <NameForm />
        <EmailForm />
        <div className="md:col-span-2">
          {linkedAccountsLoadError ? (
            linkedAccountsLoadError
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
        <PreferencesSection />
      </div>

      <div className="border-t pt-8">
        <EmailPreferences
          notificationsOptIn={notificationsOptIn}
          marketingOptIn={marketingOptIn}
        />
      </div>

      <div className="border-t pt-8">
        <div className="mx-auto w-full">
          <DeleteAccountForm />
        </div>
      </div>
    </div>
  );
}
