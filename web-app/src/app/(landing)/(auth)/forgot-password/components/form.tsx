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

import { forgotPassword } from "../actions";
import {
  forgotPasswordFormData,
  forgotPasswordFormSchema,
  type ForgotPasswordFormSchemaType,
} from "../data";

export default function ForgotPasswordForm() {
  const t = useTranslations("Auth.Pages.ForgotPassword.Form");
  const router = useRouter();

  const form = useForm<ForgotPasswordFormSchemaType>({
    resolver: zodResolver(forgotPasswordFormSchema(t)),
  });

  async function onSubmit(values: ForgotPasswordFormSchemaType) {
    const result = await forgotPassword(values);

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
            formData={forgotPasswordFormData}
            namespace="Auth.Pages.ForgotPassword.Form"
          />
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            {t("reset_password")}
          </Button>
        </fieldset>
      </form>
    </Form>
  );
}
