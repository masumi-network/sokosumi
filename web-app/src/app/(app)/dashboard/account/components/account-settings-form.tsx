"use client";

import { useTranslations } from "next-intl";

import { DeleteAccountForm } from "./delete-account-form";
import { EmailForm } from "./email-form";
import { PasswordForm } from "./password-form";

export function AccountSettingsForm() {
  const t = useTranslations("Account");

  return (
    <div className="mx-auto max-w-xl min-w-sm space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </div>
      <div className="space-y-6">
        <div className="min-w-[280px]">
          <EmailForm />
        </div>
        <div className="min-w-[280px]">
          <PasswordForm />
        </div>
        <div className="min-w-[280px]">
          <DeleteAccountForm />
        </div>
      </div>
    </div>
  );
}
