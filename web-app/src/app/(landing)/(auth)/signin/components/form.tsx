"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import TypedLink from "@/components/typed-link";
import { AuthForm, SubmitButton } from "@/landing/(auth)/components/form";
import { signin } from "@/landing/(auth)/signin/actions";
import {
  signInFormData,
  signInFormSchema,
  SignInFormSchemaType,
} from "@/landing/(auth)/signin/data";
import { AppRoute } from "@/types/routes";

export default function SignInForm() {
  const t = useTranslations("Landing.Auth.Pages.SignIn.Form");

  const router = useRouter();

  const form = useForm<SignInFormSchemaType>({
    resolver: zodResolver(
      signInFormSchema(useTranslations("Library.Auth.Schema")),
    ),
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
      namespace="Landing.Auth.Pages.SignIn.Form"
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
          <TypedLink
            route={{
              pathname: "/forgot-password",
              query: form.watch("email")
                ? { email: form.watch("email") }
                : undefined,
            }}
            className="text-primary font-medium hover:underline"
          >
            {t("ForgotPassword.link")}
          </TypedLink>
        </div>
      </div>
    </AuthForm>
  );
}
