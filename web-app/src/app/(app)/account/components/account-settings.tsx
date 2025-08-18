import { useTranslations } from "next-intl";

import { type Account } from "@/lib/auth/auth";
import { AccountProvider } from "@/lib/auth/types";

import { ApiKeysSection } from "./api-keys";
import { DeleteAccountForm } from "./delete-account-form";
import { EmailForm } from "./email-form";
import { NameForm } from "./name-form";
import { NewPasswordForm } from "./new-password-form";
import { PasswordForm } from "./password-form";
import { SocialAccounts } from "./social-accounts";

interface AccountSettingsProps {
  accounts: Account[];
}

export function AccountSettings({ accounts }: AccountSettingsProps) {
  const t = useTranslations("App.Account");

  const socialAccounts = accounts.filter(
    (account) => account.provider !== AccountProvider.CREDENTIAL,
  );
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
          <SocialAccounts socialAccounts={socialAccounts} />
        </div>

        <div className="border-t pt-8">
          <ApiKeysSection />
        </div>

        <div className="border-t pt-8">
          <div className="mx-auto w-full">
            <DeleteAccountForm />
          </div>
        </div>
      </div>
    </div>
  );
}
