"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { MemberRole } from "@sokosumi/database";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Dispatch, SetStateAction } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { authClient } from "@/lib/auth/auth.client";
import {
  inviteFormData,
  inviteFormSchema,
  InviteFormSchemaType,
} from "@/lib/schemas";

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
              router.push("/login");
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
