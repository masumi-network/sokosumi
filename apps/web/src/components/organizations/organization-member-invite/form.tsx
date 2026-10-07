"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { MemberRole } from "@sokosumi/core-client";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { Dispatch, SetStateAction } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { authClient } from "@/lib/auth/auth.client";
import {
  type InviteFormSchemaType,
  inviteFormData,
  inviteFormSchema,
} from "@/lib/schemas/invitation";

import { FormFields } from "./form-fields";

interface OrganizationMemberInviteFormProps {
  organizationId: string;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  onOpenChange: Dispatch<SetStateAction<boolean>>;
}

export default function OrganizationMemberInviteForm({
  organizationId,
  setIsLoading,
  onOpenChange,
}: OrganizationMemberInviteFormProps) {
  const t = useTranslations("Components.Organizations.InviteMemberModal.Form");
  const router = useRouter();

  const form = useForm<InviteFormSchemaType>({
    resolver: zodResolver(
      inviteFormSchema(
        useTranslations("Components.Organizations.InviteMemberModal.Schema"),
      ),
    ),
    defaultValues: {
      email: "",
    },
  });

  const onSubmit = async (values: InviteFormSchemaType) => {
    setIsLoading(true);
    const result = await authClient.organization.inviteMember({
      email: values.email,
      organizationId,
      role: MemberRole.MEMBER,
      resend: true,
    });
    if (result.error) {
      const errorMessage = result.error.message ?? t("error");
      if (result.error.status === 401) {
        toast.error(errorMessage, {
          action: {
            label: t("Errors.unauthorizedAction"),
            onClick: () => {
              router.push("/signin");
            },
          },
        });
      } else {
        toast.error(errorMessage);
      }
    } else {
      toast.success(t("success"));
      onOpenChange(false);
      router.refresh();
    }
    setIsLoading(false);
  };

  const isLoading = form.formState.isSubmitting;

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-col gap-8"
      >
        <fieldset disabled={isLoading} className="flex flex-col gap-8">
          <FormFields form={form} formData={inviteFormData} />
        </fieldset>
        {/* Outside the fieldset: a disabled fieldset would natively
            disable the button and fade its loading bar. */}
        <Button type="submit" className="w-full" loading={isLoading}>
          {t("submit")}
        </Button>
      </form>
    </Form>
  );
}
