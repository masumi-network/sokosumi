"use client";

import { ArrowLeft, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { memo } from "react";
import { UseFormReturn } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getEmailDomain } from "@/lib/utils";

import { CreateOrganizationSchemaType } from "./data";

interface CreateOrganizationProps {
  email: string;
  form: UseFormReturn<CreateOrganizationSchemaType>;
  onAfterCreate: (data: string | { name: string }) => void;
  onBack: () => void;
}

function CreateOrganization({
  email,
  form,
  onAfterCreate,
  onBack,
}: CreateOrganizationProps) {
  const t = useTranslations("Auth.Pages.SignUp.Form.Fields.Organization");

  const onSubmit = async (values: CreateOrganizationSchemaType) => {
    const { name } = values;

    // get email domain to set default required email domains
    const emailDomain = getEmailDomain(email);
    if (!emailDomain) {
      toast.error(t("invalidEmail"));
      return;
    }
    onAfterCreate({ name });
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
