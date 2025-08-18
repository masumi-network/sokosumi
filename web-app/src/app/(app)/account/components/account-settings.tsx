import { useTranslations } from "next-intl";

import { Account, AccountProvider } from "@/lib/auth/auth";

import { ApiKeysSection } from "./api-keys";
import { DeleteAccountForm } from "./delete-account-form";
import { EmailForm } from "./email-form";
import { NameForm } from "./name-form";
import { NewPasswordForm } from "./new-password-form";
import { PasswordForm } from "./password-form";

interface AccountSettingsProps {
  accounts: Account[];
}

export function AccountSettings({ accounts }: AccountSettingsProps) {
  const t = useTranslations("App.Account");

  const hasCredentialAccount = accounts.some(
    (account) => account.provider === AccountProvider.CREDENTIAL,
  );

  return (
    <div className="w-full space-y-8 md:mx-auto md:w-auto md:max-w-5xl">
      <div className="space-y-2">
        <h1 className="text-2xl font-light tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground text-sm leading-6">
          {t("description")}
        </p>
      </div>

      <div className="space-y-8">
        <div className="grid w-full grid-cols-1 gap-6 md:grid-cols-2">
          <NameForm />
          <EmailForm />
          <div className="md:col-span-2">
            {hasCredentialAccount ? <PasswordForm /> : <NewPasswordForm />}
          </div>
        </div>

        <div className="border-t pt-8">
          <ApiKeysSection />
        </div>

        <div className="border-t pt-8">
          <div className="mx-auto max-w-sm">
            <DeleteAccountForm />
          </div>
        </div>
      </div>
    </div>
  );
}
