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
import {
  createOrganizationMember,
  updatePendingInvitations,
} from "@/lib/actions";
import { authClient } from "@/lib/auth/auth.client";
import {
  isEmailAllowedByOrganization,
  OrganizationWithRelations,
} from "@/lib/db";
import { Organization } from "@/prisma/generated/client";

interface SignUpFormProps {
  organizations: OrganizationWithRelations[];
  prefilledEmail?: string | undefined;
  prefilledOrganizationId?: string | undefined;
}

export default function SignUpForm({
  organizations,
  prefilledEmail,
  prefilledOrganizationId,
}: SignUpFormProps) {
  const t = useTranslations("Auth.Pages.SignUp.Form");

  const router = useRouter();
  const form = useForm<SignUpFormSchemaType>({
    resolver: zodResolver(
      signUpFormSchema(useTranslations("Library.Auth.Schema")),
    ),
    defaultValues: {
      email: prefilledEmail ?? "",
      name: "",
      password: "",
      confirmPassword: "",
      organizationId: prefilledOrganizationId ?? "",
      termsAccepted: false,
      marketingOptIn: false,
    },
  });

  const email = form.watch("email");
  useEffect(() => {
    if (prefilledOrganizationId) {
      form.setValue("organizationId", prefilledOrganizationId);
      return;
    }
    form.setValue("organizationId", "");
  }, [email, form, prefilledOrganizationId]);

  const handleSubmit = async (values: SignUpFormSchemaType) => {
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

    const signUpData = {
      email: values.email,
      name: values.name,
      password: values.password,
      termsAccepted: values.termsAccepted,
      marketingOptIn: values.marketingOptIn,
      callbackURL: "/app",
    };
    const userResult = await authClient.signUp.email(
      {
        ...signUpData,
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
            case "TERMS_NOT_ACCEPTED":
              toast.error(t("Errors.termsNotAccepted"));
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
      // update all pending invitations
      await updatePendingInvitations(
        userResult.data.user.email,
        organization.id,
      );
      toast.success(t("success"));
    }
    router.push("/login");
  };

  const termsAccepted = form.watch("termsAccepted");

  return (
    <AuthForm
      form={form}
      formData={signUpFormData}
      prefilledEmail={prefilledEmail}
      prefilledOrganizationId={prefilledOrganizationId}
      namespace="Auth.Pages.SignUp.Form"
      onSubmit={handleSubmit}
      organizations={organizations}
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

function checkOrganizationAndEmail(
  organizations: Organization[],
  organizationId: string,
  email: string,
  t: IntlTranslation<"Auth.Pages.SignUp.Form">,
):
  | { success: true; organization: Organization }
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
