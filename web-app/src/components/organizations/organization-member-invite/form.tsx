"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { UseFormReturn } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { CommonErrorCode } from "@/lib/actions";
import { authClient } from "@/lib/auth/auth.client";
import { MemberRole } from "@/lib/db";
import { inviteFormData, InviteFormSchemaType } from "@/lib/schemas";

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

  const router = useRouter();

  const onSubmit = async (values: InviteFormSchemaType) => {
    const result = await authClient.organization.inviteMember({
      email: values.email,
      organizationId,
      role: MemberRole.MEMBER,
      resend: true,
    });
    if (result.error) {
      switch (result.error.code) {
        case CommonErrorCode.UNAUTHORIZED:
          toast.error(t("Errors.unauthorized"), {
            action: {
              label: t("Errors.unauthorizedAction"),
              onClick: () => {
                router.push("/login");
              },
            },
          });
          break;
        default:
          toast.error(result.error.message ?? t("error"));
      }
    } else {
      toast.success(t("success"));
      onOpenChange(false);
      router.refresh();
    }
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
