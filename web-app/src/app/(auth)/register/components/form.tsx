"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { AuthForm, SubmitButton } from "@/auth/components/form";
import {
  signUpFormData,
  signUpFormSchema,
  SignUpFormSchemaType,
} from "@/auth/register/data";
import { createOrganizationMember } from "@/lib/actions";
import { updateUserMarketingOptIn } from "@/lib/actions/user/action";
import { authClient } from "@/lib/auth/auth.client";
import { OrganizationWithMembersCount } from "@/lib/db";

interface SignUpFormProps {
  organizations: OrganizationWithMembersCount[];
}

export default function SignUpForm({ organizations }: SignUpFormProps) {
  const t = useTranslations("Auth.Pages.SignUp.Form");

  const router = useRouter();
  const form = useForm<SignUpFormSchemaType>({
    resolver: zodResolver(
      signUpFormSchema(useTranslations("Library.Auth.Schema")),
    ),
    defaultValues: {
      email: "",
      name: "",
      password: "",
      confirmPassword: "",
      organizationId: "",
      marketingOptIn: false,
    },
  });

  const onSubmit = async (values: SignUpFormSchemaType) => {
    console.log("values", values);
    const userResult = await authClient.signUp.email(
      {
        email: values.email,
        name: values.name,
        password: values.password,
        callbackURL: "/app",
      },
      {
        onError: (ctx) => {
          switch (ctx.error.code) {
            case "USER_ALREADY_EXISTS":
              toast.error(t("Errors.Submit.userExists"));
              break;
            case "EMAIL_DOMAIN_NOT_ALLOWED":
              toast.error(
                t("Errors.Submit.emailDomainNotAllowed", {
                  allowedEmailDomains: ctx.error.message,
                }),
              );
              break;
            default:
              toast.error(t("error"));
              break;
          }
        },
      },
    );
    if (!userResult.data?.user) {
      return;
    }

    // Update marketing opt-in status
    if (values.marketingOptIn !== undefined) {
      const marketingOptInResult = await updateUserMarketingOptIn(
        userResult.data.user.id,
        values.marketingOptIn,
      );
      console.log("marketingOptInResult", marketingOptInResult);
      if (!marketingOptInResult.success) {
        console.error(
          "Failed to update marketing opt-in:",
          marketingOptInResult.error,
        );
      }
    }

    // create member using organization
    const memberResult = await createOrganizationMember(
      userResult.data.user.id,
      values.organizationId,
    );
    if (!memberResult.success) {
      toast.error(t("errorMember"));
    } else {
      toast.success(t("success"));
    }
    router.push("/login");
  };

  return (
    <AuthForm
      form={form}
      formData={signUpFormData}
      namespace="Auth.Pages.SignUp.Form"
      onSubmit={onSubmit}
      organizations={organizations}
    >
      <div className="flex flex-col gap-4">
        <SubmitButton form={form} label={t("submit")} className="w-full" />
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
