"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";

import { BaseForm } from "@/auth/components/form/base-form";
import { FormFields } from "@/auth/components/form/form-fields";
import { signUpEmailFormData } from "@/auth/signup/data";
import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";
import {
  type SignUpEmailFormSchemaType,
  signUpEmailFormSchema,
} from "@/lib/schemas/auth";

interface SignUpEmailStepProps {
  defaultEmail: string;
  /** An invitation fixes the address; the user can only confirm it. */
  emailLocked: boolean;
  /** Set when the user came back here from the next step. */
  autoFocus: boolean;
  onFormStart: () => void;
  onContinue: (email: string) => void;
}

/**
 * First sign-up step. It only collects the address: nothing is sent, so the
 * page cannot reveal whether that address already has an account.
 */
export function SignUpEmailStep({
  defaultEmail,
  emailLocked,
  autoFocus,
  onFormStart,
  onContinue,
}: SignUpEmailStepProps) {
  const t = useTranslations("Auth.Pages.SignUp.Form");
  const form = useForm<SignUpEmailFormSchemaType>({
    resolver: zodResolver(
      signUpEmailFormSchema(useTranslations("Library.Auth.Schema")),
    ),
    defaultValues: { email: defaultEmail },
  });

  useMountEffect(() => {
    if (autoFocus) {
      form.setFocus("email");
    }
  });

  async function handleSubmit(values: SignUpEmailFormSchemaType) {
    onContinue(values.email);
  }

  return (
    <BaseForm form={form} onSubmit={handleSubmit} onChange={onFormStart}>
      <FormFields
        form={form}
        formData={
          emailLocked
            ? signUpEmailFormData.map((item) => ({ ...item, disabled: true }))
            : signUpEmailFormData
        }
        namespace="Auth.Pages.SignUp.Form"
      />
      <Button type="submit" variant="primary" className="w-full">
        {t("continueWithEmail")}
      </Button>
    </BaseForm>
  );
}
