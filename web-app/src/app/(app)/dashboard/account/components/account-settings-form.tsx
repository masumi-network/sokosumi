"use client";

import { DeleteAccountForm } from "./delete-account-form";
import { EmailForm } from "./email-form";
import { PasswordForm } from "./password-form";

export function AccountSettingsForm() {
  return (
    <div className="space-y-6">
      <EmailForm />
      <PasswordForm />
      <DeleteAccountForm />
    </div>
  );
}
