"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { FormFields } from "@/app/(landing)/(auth)/components/form-fields";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";

import { signin } from "../actions";
import {
  signInFormData,
  signInFormSchema,
  SignInFormSchemaType,
} from "../data";

export default function SignInForm() {
  const t = useTranslations("Auth.Pages.SignIn.Form");
  const router = useRouter();

  const form = useForm<SignInFormSchemaType>({
    resolver: zodResolver(signInFormSchema(t)),
  });

  const onSubmit = async (values: SignInFormSchemaType) => {
    const result = await signin(values);

    if (result.success) {
      toast.success(t("success"));
      router.push("/dashboard");
    } else {
      toast.error(t("error"));
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <fieldset
          disabled={form.formState.isSubmitting}
          className="flex flex-col gap-6"
        >
          <FormFields
            form={form}
            formData={signInFormData}
            namespace="Auth.Pages.SignIn.Form"
          />
          <div className="flex flex-col items-center justify-between gap-2 sm:flex-row">
            <Button
              type="submit"
              className="w-full sm:w-auto"
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {t("submit")}
            </Button>
            <div className="text-sm">
              <span className="text-muted-foreground">
                {t("ForgotPassword.text")}{" "}
              </span>
              <Link
                href="/forgot-password"
                className="text-primary font-medium hover:underline"
              >
                {t("ForgotPassword.link")}
              </Link>
            </div>
          </div>
        </fieldset>
      </form>
    </Form>
  );
}
