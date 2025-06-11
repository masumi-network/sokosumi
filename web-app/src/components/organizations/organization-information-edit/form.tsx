"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { UseFormReturn } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import {
  OrganizationActionErrorCode,
  updateOrganizationInformation,
} from "@/lib/actions";

import { editFormData, EditFormSchemaType } from "./data";
import { FormFields } from "./form-fields";

interface OrganizationInformationEditFormProps {
  organizationId: string;
  form: UseFormReturn<EditFormSchemaType>;
  onOpenChange: (open: boolean) => void;
}

export default function OrganizationInformationEditForm({
  organizationId,
  form,
  onOpenChange,
}: OrganizationInformationEditFormProps) {
  const t = useTranslations(
    "Components.Organizations.EditInformationModal.Form",
  );
  const router = useRouter();

  const onSubmit = async (values: EditFormSchemaType) => {
    const result = await updateOrganizationInformation(organizationId, {
      name: values.name,
      metadata: values.metadata === "" ? undefined : values.metadata,
      requiredEmailDomains: values.requiredEmailDomains,
    });
    if (!result.success) {
      switch (result.error.code) {
        case OrganizationActionErrorCode.NOT_AUTHENTICATED:
          toast.error(t("Errors.notAuthenticated"));
          router.push("/login");
          break;
        case OrganizationActionErrorCode.UNAUTHORIZED:
          toast.error(t("Errors.unauthorized"));
          break;
        default:
          toast.error(t("error"));
      }
      return;
    }

    toast.success(t("success"));
    onOpenChange(false);
  };

  const isLoading = form.formState.isSubmitting;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <fieldset disabled={isLoading} className="flex flex-col gap-8">
          <FormFields form={form} formData={editFormData} />
          <Button type="submit" disabled={isLoading} className="w-full">
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("submit")}
          </Button>
        </fieldset>
      </form>
    </Form>
  );
}
