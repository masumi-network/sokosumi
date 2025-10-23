"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Dispatch, SetStateAction } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { generateOrganizationSlug } from "@/lib/actions";
import { authClient } from "@/lib/auth/auth.client";
import {
  organizationInformationFormSchema,
  OrganizationInformationFormSchemaType,
} from "@/lib/schemas";
import { Organization } from "@/prisma/generated/client";

import { organizationInformationFormData } from "./data";
import { FormFields } from "./form-fields";

interface OrganizationInformationFormProps {
  organization: Organization | null;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  onOpenChange: Dispatch<SetStateAction<boolean>>;
}

export default function OrganizationInformationForm({
  organization,
  setIsLoading,
  onOpenChange,
}: OrganizationInformationFormProps) {
  const t = useTranslations("Components.Organizations.InformationModal.Form");
  const router = useRouter();

  const form = useForm<OrganizationInformationFormSchemaType>({
    resolver: zodResolver(
      organizationInformationFormSchema(
        useTranslations("Components.Organizations.InformationModal.Schema"),
      ),
    ),
    defaultValues: {
      name: "",
    },
  });

  const onSubmit = async (values: OrganizationInformationFormSchemaType) => {
    setIsLoading(true);
    let result;
    const isCreating = !organization;
    if (isCreating) {
      const slugResult = await generateOrganizationSlug({
        name: values.name,
      });
      if (!slugResult.ok) {
        toast.error(t("Error.create"));
        return;
      }
      const slug = slugResult.data;
      result = await authClient.organization.create({
        slug,
        name: values.name,
      });
    } else {
      result = await authClient.organization.update({
        organizationId: organization.id,
        data: {
          name: values.name,
        },
      });
    }

    if (result.error) {
      const errorMessage =
        result.error.message ??
        (isCreating ? t("Error.create") : t("Error.edit"));
      if (result.error.status === 401) {
        toast.error(errorMessage, {
          action: {
            label: t("Errors.unauthorizedAction"),
            onClick: async () => {
              router.push("/login");
            },
          },
        });
      } else {
        toast.error(errorMessage);
      }
    } else {
      toast.success(isCreating ? t("Success.create") : t("Success.edit"));
      router.refresh();
      onOpenChange(false);
    }
    setIsLoading(false);
  };

  const isCreating = !organization;
  const isLoading = form.formState.isSubmitting;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <fieldset disabled={isLoading} className="flex flex-col gap-8">
          <FormFields form={form} formData={organizationInformationFormData} />
          <Button type="submit" disabled={isLoading} className="w-full">
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isCreating ? t("Submit.create") : t("Submit.edit")}
          </Button>
        </fieldset>
      </form>
    </Form>
  );
}
