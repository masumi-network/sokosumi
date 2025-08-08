"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { useForm } from "react-hook-form";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  removeOrganizationSchema,
  RemoveOrganizationSchemaType,
} from "@/lib/schemas";
import { Organization } from "@/prisma/generated/client";

import OrganizationRemoveForm from "./form";

interface OrganizationRemoveModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organization: Organization;
}

export default function OrganizationRemoveModal({
  open,
  onOpenChange,
  organization,
}: OrganizationRemoveModalProps) {
  const t = useTranslations("Components.Organizations.RemoveModal");

  const form = useForm<RemoveOrganizationSchemaType>({
    resolver: zodResolver(
      removeOrganizationSchema(
        useTranslations("Components.Organizations.RemoveModal.Schema"),
      ),
    ),
    defaultValues: {
      name: "",
      confirmName: "",
    },
  });

  useEffect(() => {
    if (!open || !organization) {
      return;
    }
    form.setValue("name", organization.name);
  }, [open, form, organization]);

  const handleOpenChange = (open: boolean) => {
    if (form.formState.isSubmitting) {
      return;
    }
    onOpenChange(open);
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-center text-lg font-medium">
            {t("title")}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-muted-foreground text-center text-base">
            {t("description", { organization: organization.name })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <OrganizationRemoveForm organization={organization} form={form} />
      </AlertDialogContent>
    </AlertDialog>
  );
}
