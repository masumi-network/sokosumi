"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { AuthForm, SubmitButton } from "@/app/(landing)/(auth)/components/form";
import { signin } from "@/app/(landing)/(auth)/signin/actions";
import {
  signInFormData,
  signInFormSchema,
  SignInFormSchemaType,
} from "@/app/(landing)/(auth)/signin/data";
import { AppRoute, LandingRoute } from "@/types/routes";

export default function SignInForm() {
  const t = useTranslations("Auth.Pages.SignIn.Form");

  const router = useRouter();

  const form = useForm<SignInFormSchemaType>({
    resolver: zodResolver(signInFormSchema(useTranslations("Auth.Schema"))),
    defaultValues: {
      email: "",
      currentPassword: "",
    },
  });

  const onSubmit = async (values: SignInFormSchemaType) => {
    const { success, error } = await signin(values);
    if (success) {
      toast.success(t("success"));
      router.push(AppRoute.Home);
    } else {
      switch (error) {
        case "emailNotVerified":
          toast.error(t("Errors.Submit.verifyEmail"));
          break;
        default:
          toast.error(t("error"));
      }
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
            href={`${LandingRoute.ForgotPassword}${form.watch("email") ? `?email=${encodeURIComponent(form.watch("email"))}` : ""}`}
            className="text-primary font-medium hover:underline"
          >
            {t("ForgotPassword.link")}
          </Link>
        </div>
      </div>
    </AuthForm>
  );
}
