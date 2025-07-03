"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { UseFormReturn } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { useAsyncRouter } from "@/hooks/use-async-router";
import { CommonErrorCode, updateOrganizationInformation } from "@/lib/actions";
import { UpdateOrganizationInformationFormSchemaType } from "@/lib/schemas";

import { updateOrganizationInformationFormData } from "./data";
import { FormFields } from "./form-fields";

interface OrganizationInformationEditFormProps {
  organizationId: string;
  form: UseFormReturn<UpdateOrganizationInformationFormSchemaType>;
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
  const router = useAsyncRouter();

  const onSubmit = async (
    values: UpdateOrganizationInformationFormSchemaType,
  ) => {
    const result = await updateOrganizationInformation(organizationId, values);
    if (result.ok) {
      toast.success(t("success"));
      onOpenChange(false);
    } else {
      switch (result.error.code) {
        case CommonErrorCode.UNAUTHENTICATED:
          toast.error(t("Errors.unauthenticated"), {
            action: {
              label: t("Errors.unauthenticatedAction"),
              onClick: async () => {
                await router.push("/login");
              },
            },
          });
          break;
        case CommonErrorCode.UNAUTHORIZED:
          toast.error(t("Errors.unauthorized"));
          break;
        default:
          toast.error(t("error"));
      }
      return;
    }
  };

  const isLoading = form.formState.isSubmitting;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <fieldset disabled={isLoading} className="flex flex-col gap-8">
          <FormFields
            form={form}
            formData={updateOrganizationInformationFormData}
          />
          <Button type="submit" disabled={isLoading} className="w-full">
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("submit")}
          </Button>
        </fieldset>
      </form>
    </Form>
  );
}
