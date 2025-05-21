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
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { authClient } from "@/lib/auth/auth.client";
import { Organization } from "@/prisma/generated/client";

import { OrganizationInput } from "./organization-input";

interface SignUpFormProps {
  organizations: Organization[];
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
    },
  });

  const organizationId = form.watch("organizationId");
  const organization = organizations.find(
    (organization) => organization.id === organizationId,
  );
  const handleOrganizationChange = (organization: Organization) => {
    form.setValue("organizationId", organization.id);
  };

  const onSubmit = async (values: SignUpFormSchemaType) => {
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
    if (!!userResult.data?.user) {
      toast.success(t("success"));
      router.push("/login");
    }
  };

  return (
    <AuthForm
      form={form}
      formData={signUpFormData}
      namespace="Auth.Pages.SignUp.Form"
      onSubmit={onSubmit}
    >
      <div className="flex flex-col gap-4">
        <FormField
          key="organizationId"
          control={form.control}
          name="organizationId"
          render={() => (
            <FormItem>
              <FormControl>
                <OrganizationInput
                  organizations={organizations}
                  value={organization}
                  onChange={handleOrganizationChange}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
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
