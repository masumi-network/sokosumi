"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { FormFields } from "@/app/(landing)/(auth)/components/form-fields";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";

import { resetPassword } from "../actions";
import {
  resetPasswordFormData,
  resetPasswordFormSchema,
  type ResetPasswordFormSchemaType,
} from "../data";

interface ResetPasswordFormProps {
  token: string;
}

export default function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const t = useTranslations("Auth.Pages.ResetPassword.Form");
  const router = useRouter();

  const form = useForm<ResetPasswordFormSchemaType>({
    resolver: zodResolver(resetPasswordFormSchema(t)),
    defaultValues: {
      token: token,
    },
  });

  async function onSubmit(values: ResetPasswordFormSchemaType) {
    const result = await resetPassword(values);

    if (result.success) {
      toast.success(t("success"));
      router.push("/signin");
    } else {
      toast.error(t("error"));
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <fieldset
          disabled={form.formState.isSubmitting}
          className="flex flex-col gap-6"
        >
          <FormFields
            form={form}
            formData={resetPasswordFormData}
            namespace="Auth.Pages.ResetPassword.Form"
          />
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            {t("submit")}
          </Button>
        </fieldset>
      </form>
    </Form>
  );
}
