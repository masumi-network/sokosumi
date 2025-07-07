"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { AuthForm, SubmitButton } from "@/auth/components/form";
import { signUpFormData } from "@/auth/register/data";
import { useAsyncRouter } from "@/hooks/use-async-router";
import { AuthErrorCode, CommonErrorCode, signUpEmail } from "@/lib/actions";
import { OrganizationWithRelations } from "@/lib/db";
import { signUpFormSchema, SignUpFormSchemaType } from "@/lib/schemas";

interface SignUpFormProps {
  prefilledEmail?: string | undefined;
  prefilledOrganization?: OrganizationWithRelations | null;
  invitationId?: string | undefined;
}

export default function SignUpForm({
  prefilledEmail,
  prefilledOrganization,
  invitationId,
}: SignUpFormProps) {
  const t = useTranslations("Auth.Pages.SignUp.Form");

  const router = useAsyncRouter();
  const form = useForm<SignUpFormSchemaType>({
    resolver: zodResolver(
      signUpFormSchema(useTranslations("Library.Auth.Schema")),
    ),
    defaultValues: {
      email: prefilledEmail ?? "",
      name: "",
      password: "",
      confirmPassword: "",
      selectedOrganization: prefilledOrganization ?? undefined,
      termsAccepted: false,
      marketingOptIn: false,
    },
  });

  const email = form.watch("email");
  useEffect(() => {
    if (prefilledOrganization) {
      form.setValue("selectedOrganization", { id: prefilledOrganization.id });
      return;
    }
    form.setValue("selectedOrganization", {
      name: "",
    });
  }, [email, form, prefilledOrganization]);

  const handleSubmit = async (values: SignUpFormSchemaType) => {
    const result = await signUpEmail(
      {
        email: values.email,
        name: values.name,
        password: values.password,
        confirmPassword: values.confirmPassword,
        termsAccepted: values.termsAccepted,
        marketingOptIn: values.marketingOptIn,
        selectedOrganization: values.selectedOrganization,
      },
      invitationId,
    );

    if (result.ok) {
      toast.success(t("success"));
      await router.push("/login");
    } else {
      switch (result.error.code) {
        case CommonErrorCode.BAD_INPUT:
          toast.error(t("Errors.badInput"));
          break;
        case AuthErrorCode.ORGANIZATION_NOT_FOUND:
          toast.error(t("Errors.organizationNotFound"));
          break;
        case AuthErrorCode.ORGANIZATION_CREATE_FAILED:
          toast.error(t("Errors.organizationCreateFailed"));
          break;
        case AuthErrorCode.EMAIL_DOMAIN_INVALID:
          toast.error(t("Errors.emailDomainInvalid"));
          break;
        case AuthErrorCode.EMAIL_NOT_ALLOWED_BY_ORGANIZATION:
          toast.error(t("Errors.emailNotAllowedByOrganization"));
          break;
        case AuthErrorCode.INVITATION_NOT_FOUND:
          toast.error(t("Errors.invitationNotFound"));
          break;
        case AuthErrorCode.MEMBER_CREATE_FAILED:
          toast.error(t("Errors.memberCreateFailed"));
          break;
        case AuthErrorCode.USER_ALREADY_EXISTS:
          toast.error(t("Errors.userExists"));
          break;
        case AuthErrorCode.TERMS_NOT_ACCEPTED:
          toast.error(t("Errors.termsNotAccepted"));
          break;
        default:
          toast.error(t("error"));
          break;
      }
    }
  };

  const termsAccepted = form.watch("termsAccepted");

  return (
    <AuthForm
      form={form}
      formData={signUpFormData}
      prefilledOrganization={prefilledOrganization}
      namespace="Auth.Pages.SignUp.Form"
      onSubmit={handleSubmit}
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
