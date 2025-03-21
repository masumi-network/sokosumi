"use client";

import { useTranslations } from "next-intl";

import { DeleteAccountForm } from "./delete-account-form";
import { EmailForm } from "./email-form";
import { NameForm } from "./name-form";
import { PasswordForm } from "./password-form";

export function AccountSettingsForm() {
  const t = useTranslations("Account");

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground text-sm leading-6">
          {t("description")}
        </p>
      </div>

      <div className="space-y-8">
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
          <NameForm />
          <EmailForm />
          <PasswordForm />
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
