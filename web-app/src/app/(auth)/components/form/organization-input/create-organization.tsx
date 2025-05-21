"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { UseFormReturn } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createOrganizationFromName } from "@/lib/actions";
import { Organization } from "@/prisma/generated/client";

import { CreateOrganizationSchemaType } from "./data";

interface CreateOrganizationProps {
  form: UseFormReturn<CreateOrganizationSchemaType>;
  onCreate: (organization: Organization) => void;
}

export default function CreateOrganization({
  form,
  onCreate,
}: CreateOrganizationProps) {
  const t = useTranslations("Auth.Pages.SignUp.Form.Fields.Organization");

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.stopPropagation();
    form.handleSubmit(onSubmit)(e);
  };

  const onSubmit = async (values: CreateOrganizationSchemaType) => {
    const organizationResult = await createOrganizationFromName(values.name);
    if (organizationResult.success && organizationResult.organization) {
      toast.success(t("success"));
      onCreate(organizationResult.organization);
    } else {
      toast.error(t("error"));
    }
  };

  const name = form.watch("name");

  return (
    <form onSubmit={handleSubmit}>
      <fieldset
        disabled={form.formState.isSubmitting}
        className="flex flex-col gap-3"
      >
        <Input
          {...form.register("name")}
          placeholder={t("createPlaceholder")}
        />
        <Button
          disabled={!name || form.formState.isSubmitting}
          type="submit"
          size="sm"
          variant="primary"
          className="text-xs"
        >
          {form.formState.isSubmitting && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          {t("create", { organization: name })}
        </Button>
      </fieldset>
    </form>
  );
}
