"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { AuthForm, SubmitButton } from "@/auth/components/form";
import {
  signUpFormData,
  signUpFormSchema,
  SignUpFormSchemaType,
} from "@/auth/register/data";
import { useAsyncRouterPush } from "@/hooks/use-async-router";
import { signUpEmail } from "@/lib/actions/auth";
import { OrganizationWithRelations } from "@/lib/db/organization/types";

interface SignUpFormProps {
  prefilledEmail?: string | undefined;
  prefilledOrganization?: OrganizationWithRelations | null;
}

export default function SignUpForm({
  prefilledEmail,
  prefilledOrganization,
}: SignUpFormProps) {
  const t = useTranslations("Auth.Pages.SignUp.Form");

  const router = useAsyncRouterPush();
  const form = useForm<SignUpFormSchemaType>({
    resolver: zodResolver(
      signUpFormSchema(useTranslations("Library.Auth.Schema")),
    ),
    defaultValues: {
      email: prefilledEmail ?? "",
      name: "",
      password: "",
      confirmPassword: "",
      selectedOrganization: {
        id: prefilledOrganization?.id ?? "",
        name: prefilledOrganization?.name ?? "",
      },
      termsAccepted: false,
      marketingOptIn: false,
    },
  });

  const email = form.watch("email");
  useEffect(() => {
    if (prefilledOrganization) {
      form.setValue("selectedOrganization", prefilledOrganization);
      return;
    }
    form.setValue("selectedOrganization", {
      id: "",
      name: "",
    });
  }, [email, form, prefilledOrganization]);

  const onSubmit = async (values: SignUpFormSchemaType) => {
    try {
      if (
        values.selectedOrganization.id == null &&
        values.selectedOrganization.name == null
      ) {
        toast.error(t("Errors.organizationNameRequired"));
        return;
      }
      const signUpResult = await signUpEmail(
        values.name,
        values.selectedOrganization.id
          ? null
          : values.selectedOrganization.name!,
        values.email,
        values.password,
        values.selectedOrganization?.id ?? null,
        values.termsAccepted,
        values.marketingOptIn ?? false,
        "/app",
      );
      if (signUpResult.success) {
        toast.success(t("success"));
        await router.push("/login");
      } else {
        if (signUpResult.error === "EMAIL_NOT_ALLOWED_BY_ORGANIZATION") {
          toast.error(t("Errors.emailDomainNotAllowedByOrganization"));
        } else if (signUpResult.error === "User already exists") {
          toast.error(t("Errors.userExists"));
        } else {
          toast.error(t("error"));
        }
      }
    } catch (error) {
      toast.error(t("error"));
      console.log(error);
    }
  };

  const termsAccepted = form.watch("termsAccepted");

  return (
    <AuthForm
      form={form}
      formData={signUpFormData}
      prefilledEmail={prefilledEmail}
      prefilledOrganization={prefilledOrganization}
      namespace="Auth.Pages.SignUp.Form"
      onSubmit={onSubmit}
    >
      <div className="flex flex-col gap-4">
        <SubmitButton
          form={form}
          label={t("submit")}
          className="w-full"
          disabled={!termsAccepted}
        />
        <div className="flex flex-col items-center gap-2 sm:flex-row">
          <span className="text-muted-foreground text-sm">
            {t("Login.message")}
          </span>
          <Link
            href="/login"
            className="text-primary text-sm font-medium hover:underline"
          >
            {t("Login.link")}
          </Link>
        </div>
      </div>
    </AuthForm>
  );
}
