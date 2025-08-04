"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { useForm } from "react-hook-form";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
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
      metadata: "",
    },
  });
  const isLoading = form.formState.isSubmitting;

  useEffect(() => {
    if (!open || !organization) {
      return;
    }

    const { name, metadata } = organization;
    form.setValue("name", name);
    form.setValue("metadata", metadata ?? "");
  }, [organization, form, open]);

  const handleOpenChange = (open: boolean) => {
    if (isLoading) {
      return;
    }
    onOpenChange(open);
  };

  const isCreating = !organization;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPortal>
        <DialogOverlay className="backdrop-blur-lg" />
        <DialogContent className="max-h-[80svh] w-[80vw] max-w-2xl!">
          <DialogTitle className="text-center">
            {isCreating ? t("create") : t("edit")}
          </DialogTitle>
          <DialogDescription className="hidden" />
          <OrganizationInformationForm
            organizationId={organization?.id ?? null}
            form={form}
            onOpenChange={onOpenChange}
          />
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
