import { useTranslations } from "next-intl";

import { ApiKeysSection } from "./api-keys";
import { DeleteAccountForm } from "./delete-account-form";
import { EmailForm } from "./email-form";
import { NameForm } from "./name-form";
import { PasswordForm } from "./password-form";

export function AccountSettings() {
  const t = useTranslations("App.Account");

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-light tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground text-sm leading-6">
          {t("description")}
        </p>
      </div>

      <div className="space-y-8">
        <div className="grid w-full grid-cols-1 gap-6 md:grid-cols-2">
          <NameForm />
          <EmailForm />
          <div className="md:col-span-2">
            <PasswordForm />
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
