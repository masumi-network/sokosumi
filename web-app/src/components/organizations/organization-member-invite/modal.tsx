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

import { inviteFormSchema, InviteFormSchemaType } from "./data";
import OrganizationMemberInviteForm from "./form";

interface OrganizationInformationEditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
}

export default function OrganizationMemberInviteModal({
  open,
  onOpenChange,
  organizationId,
}: OrganizationInformationEditModalProps) {
  const t = useTranslations("Components.Organizations.InviteMemberModal");

  const form = useForm<InviteFormSchemaType>({
    resolver: zodResolver(
      inviteFormSchema(
        useTranslations("Components.Organizations.InviteMemberModal.Schema"),
      ),
    ),
    defaultValues: {
      email: "",
    },
  });
  const isLoading = form.formState.isSubmitting;

  useEffect(() => {
    if (!open) {
      return;
    }
  }, [organizationId, form, open]);

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
        <DialogContent className="max-h-[80svh] w-[80vw] max-w-md!">
          <DialogTitle className="text-center">{t("title")}</DialogTitle>
          <DialogDescription className="hidden" />
          <OrganizationMemberInviteForm
            organizationId={organizationId}
            form={form}
            onOpenChange={onOpenChange}
          />
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
