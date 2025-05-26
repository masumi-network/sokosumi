"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { createOrganizationMember } from "@/lib/actions";
import { updateUserMarketingOptIn } from "@/lib/actions/user/action";
import { authClient } from "@/lib/auth/auth.client";
import {
  isEmailAllowedByOrganization,
  OrganizationWithRelations,
} from "@/lib/db";

interface SignUpFormProps {
  organizations: OrganizationWithRelations[];
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

  const email = form.watch("email");
  useEffect(() => {
    form.setValue("organizationId", "");
  }, [email, form]);

  const onSubmit = async (values: SignUpFormSchemaType) => {
    const organizationResult = checkOrganizationAndEmail(
      organizations,
      values.organizationId,
      values.email,
      t,
    );
    if (!organizationResult.success) {
      toast.error(organizationResult.error);
      return;
    }
    const { organization } = organizationResult;

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
              toast.error(t("Errors.userExists"));
              break;
            case "EMAIL_DOMAIN_NOT_ALLOWED":
              toast.error(
                t("Errors.emailDomainNotAllowed", {
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
    if (values.marketingOptIn) {
      const marketingOptInResult = await updateUserMarketingOptIn(
        userResult.data.user.id,
        values.marketingOptIn,
      );
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
      userResult.data.user.email,
      organization,
    );
    if (!memberResult.success) {
      if (memberResult.code === "EMAIL_DOMAIN_NOT_ALLOWED_BY_ORGANIZATION") {
        toast.error(t("Errors.emailDomainNotAllowedByOrganization"));
      } else {
        toast.error(t("Errors.member"));
      }
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

function checkOrganizationAndEmail(
  organizations: OrganizationWithRelations[],
  organizationId: string,
  email: string,
  t: IntlTranslation<"Auth.Pages.SignUp.Form">,
):
  | { success: true; organization: OrganizationWithRelations }
  | { success: false; error: string } {
  const organization = organizations.find(
    (organization) => organization.id === organizationId,
  );
  if (!organization) {
    return { success: false, error: t("Errors.organization") };
  }

  if (!isEmailAllowedByOrganization(email, organization)) {
    return {
      success: false,
      error: t("Errors.emailDomainNotAllowedByOrganization"),
    };
  }

  return { success: true, organization };
}
