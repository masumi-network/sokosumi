"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { memo } from "react";
import { UseFormReturn } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createOrganizationFromName } from "@/lib/actions";
import { Organization } from "@/prisma/generated/client";

import { CreateOrganizationSchemaType } from "./data";

interface CreateOrganizationProps {
  form: UseFormReturn<CreateOrganizationSchemaType>;
  onAfterCreate: (organization: Organization) => void;
}

function CreateOrganization({ form, onAfterCreate }: CreateOrganizationProps) {
  const t = useTranslations("Auth.Pages.SignUp.Form.Fields.Organization");

  const onSubmit = async (values: CreateOrganizationSchemaType) => {
    const organizationResult = await createOrganizationFromName(values.name);
    if (organizationResult.success && organizationResult.organization) {
      toast.success(t("success"));
      onAfterCreate(organizationResult.organization);
    } else {
      toast.error(t("error"));
    }
  };

  const name = form.watch("name");

  return (
    <div>
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
          onClick={form.handleSubmit(onSubmit)}
        >
          {form.formState.isSubmitting && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          {t("create", { organization: name })}
        </Button>
      </fieldset>
    </div>
  );
}

export default memo(CreateOrganization);
