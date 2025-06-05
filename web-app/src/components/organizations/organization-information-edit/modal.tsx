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
import { Organization } from "@/prisma/generated/client";

import { editFormSchema, EditFormSchemaType } from "./data";
import OrganizationInformationEditForm from "./form";

interface OrganizationInformationEditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organization: Organization;
}

export default function OrganizationInformationEditModal({
  open,
  onOpenChange,
  organization,
}: OrganizationInformationEditModalProps) {
  const t = useTranslations("Components.Organizations.EditInformationModal");

  const form = useForm<EditFormSchemaType>({
    resolver: zodResolver(
      editFormSchema(
        useTranslations("Components.Organizations.EditInformationModal.Schema"),
      ),
    ),
    defaultValues: {
      name: "",
      metadata: "",
      requiredEmailDomains: [],
    },
  });
  const isLoading = form.formState.isSubmitting;

  useEffect(() => {
    if (!open) {
      return;
    }
    const { name, metadata, requiredEmailDomains } = organization;
    form.setValue("name", name);
    form.setValue("metadata", metadata ?? "");
    form.setValue("requiredEmailDomains", requiredEmailDomains ?? []);
  }, [organization, form, open]);

  const handleOpenChange = (open: boolean) => {
    if (isLoading) {
      return;
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPortal>
        <DialogOverlay className="backdrop-blur-lg" />
        <DialogContent className="max-h-[80svh] w-[80vw] max-w-2xl!">
          <DialogTitle className="text-center">{t("title")}</DialogTitle>
          <DialogDescription className="hidden" />
          <OrganizationInformationEditForm
            organizationId={organization.id}
            form={form}
            onOpenChange={onOpenChange}
          />
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
