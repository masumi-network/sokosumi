"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { useForm } from "react-hook-form";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  organizationInformationFormSchema,
  OrganizationInformationFormSchemaType,
} from "@/lib/schemas";
import { Organization } from "@/prisma/generated/client";

import OrganizationInformationForm from "./form";

interface OrganizationInformationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organization: Organization | null;
}

export default function OrganizationInformationModal({
  open,
  onOpenChange,
  organization,
}: OrganizationInformationModalProps) {
  const t = useTranslations("Components.Organizations.InformationModal.Title");

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

  useEffect(() => {
    if (!open || !organization) {
      return;
    }

    const { name } = organization;
    form.setValue("name", name);
  }, [organization, form, open]);

  const handleOpenChange = (open: boolean) => {
    if (form.formState.isSubmitting) {
      return;
    }
    onOpenChange(open);
  };

  const isCreating = !organization;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[80svh] w-[30vw] max-w-2xl!">
        <DialogTitle className="text-center">
          {isCreating ? t("create") : t("edit")}
        </DialogTitle>
        <DialogDescription className="hidden" />
        <OrganizationInformationForm
          organization={organization}
          form={form}
          onOpenChange={onOpenChange}
        />
      </DialogContent>
    </Dialog>
  );
}
