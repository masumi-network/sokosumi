"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { UseFormReturn } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import {
  CommonErrorCode,
  createOrganization,
  updateOrganizationInformation,
} from "@/lib/actions";
import { OrganizationInformationFormSchemaType } from "@/lib/schemas";

import { updateOrganizationInformationFormData } from "./data";
import { FormFields } from "./form-fields";

interface OrganizationInformationFormProps {
  organizationId: string | null;
  form: UseFormReturn<OrganizationInformationFormSchemaType>;
  onOpenChange: (open: boolean) => void;
}

export default function OrganizationInformationForm({
  organizationId,
  form,
  onOpenChange,
}: OrganizationInformationFormProps) {
  const t = useTranslations("Components.Organizations.InformationModal.Form");
  const router = useRouter();

  const isCreating = !organizationId;

  const onSubmit = async (values: OrganizationInformationFormSchemaType) => {
    const result = isCreating
      ? await createOrganization(values)
      : await updateOrganizationInformation(organizationId, values);
    if (result.ok) {
      toast.success(isCreating ? t("Success.create") : t("Success.edit"));
      onOpenChange(false);
      router.refresh();
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
          toast.error(isCreating ? t("Error.create") : t("Error.edit"));
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
            {isCreating ? t("Submit.create") : t("Submit.edit")}
          </Button>
        </fieldset>
      </form>
    </Form>
  );
}
