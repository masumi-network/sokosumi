"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { AuthForm, SubmitButton } from "@/app/(landing)/(auth)/components/form";
import { createErrorMap } from "@/lib/form";

import { signin } from "../actions";
import {
  signInFormData,
  signInFormSchema,
  SignInFormSchemaType,
} from "../data";

export default function SignInForm() {
  const t = useTranslations("Auth.Pages.SignIn.Form");
  const tSchema = useTranslations("Auth.Schema");

  const router = useRouter();

  const form = useForm<SignInFormSchemaType>({
    resolver: zodResolver(signInFormSchema, {
      errorMap: createErrorMap({ tSchema }),
    }),
    defaultValues: {
      email: "",
      currentPassword: "",
    },
  });

  const onSubmit = async (values: SignInFormSchemaType) => {
    try {
      await signin(values);
      toast.success(t("success"));
      router.push("/dashboard");
    } catch (error) {
      if (error && typeof error === "object" && "statusCode" in error) {
        if (error.statusCode === 403) {
          toast.error(t("Errors.Submit.verifyEmail"));
          return;
        }
      }
      toast.error(t("Errors.Submit.invalid"));
    }
  };

  return (
    <AuthForm
      form={form}
      formData={signInFormData}
      namespace="Auth.Pages.SignIn.Form"
      onSubmit={onSubmit}
    >
      <div className="flex flex-col items-center justify-between gap-2 sm:flex-row">
        <SubmitButton
          form={form}
          label={t("submit")}
          className="w-full sm:w-auto"
        />
        <div className="text-sm">
          <span className="text-muted-foreground">
            {t("ForgotPassword.text")}{" "}
          </span>
          <Link
            href={`/forgot-password${form.watch("email") ? `?email=${encodeURIComponent(form.watch("email"))}` : ""}`}
            className="text-primary font-medium hover:underline"
          >
            {t("ForgotPassword.link")}
          </Link>
        </div>
      </div>
    </AuthForm>
  );
}
