"use client";

import { ArrowLeft, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { memo } from "react";
import { UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import z from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { CreateOrganizationSchemaType } from "./data";

interface CreateOrganizationProps {
  email: string;
  form: UseFormReturn<CreateOrganizationSchemaType>;
  onAfterCreate: (organizationName: string) => void;
  onBack: () => void;
}
const createOrganizationSchema = z.object({
  name: z.string().min(1).max(250),
});

function CreateOrganization({
  form,
  onAfterCreate,
  onBack,
}: CreateOrganizationProps) {
  const t = useTranslations("Auth.Pages.SignUp.Form.Fields.Organization");

  const onSubmit = async (values: CreateOrganizationSchemaType) => {
    const organizationResult = createOrganizationSchema.safeParse(values);
    if (!organizationResult.success) {
      toast.error(t("error"));
      return;
    }

    onAfterCreate(organizationResult.data.name);
  };

  const name = form.watch("name");

  return (
    <div>
      <fieldset
        disabled={form.formState.isSubmitting}
        className="flex flex-col gap-3"
      >
        <Button size="icon" variant="outline" onClick={onBack}>
          <ArrowLeft />
        </Button>
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
