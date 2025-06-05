"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { UseFormReturn } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { authClient } from "@/lib/auth/auth.client";

import { inviteFormData, InviteFormSchemaType } from "./data";
import { FormFields } from "./form-fields";

interface OrganizationMemberInviteFormProps {
  organizationId: string;
  form: UseFormReturn<InviteFormSchemaType>;
  onOpenChange: (open: boolean) => void;
}

export default function OrganizationMemberInviteForm({
  organizationId,
  form,
  onOpenChange,
}: OrganizationMemberInviteFormProps) {
  const t = useTranslations("Components.Organizations.InviteMemberModal.Form");

  const onSubmit = async (values: InviteFormSchemaType) => {
    await authClient.organization.inviteMember(
      {
        email: values.email,
        organizationId,
        role: "member",
        resend: true,
      },
      {
        onError: () => {
          toast.error(t("error"));
        },
        onSuccess: () => {
          toast.success(t("success"));
          onOpenChange(false);
        },
      },
    );
  };

  const isLoading = form.formState.isSubmitting;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <fieldset disabled={isLoading} className="flex flex-col gap-8">
          <FormFields form={form} formData={inviteFormData} />
          <Button type="submit" disabled={isLoading} className="w-full">
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("submit")}
          </Button>
        </fieldset>
      </form>
    </Form>
  );
}
