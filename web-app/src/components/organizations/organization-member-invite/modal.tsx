"use client";

import { useTranslations } from "next-intl";
import { Dispatch, SetStateAction, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

import OrganizationMemberInviteForm from "./form";

interface OrganizationInformationEditModalProps {
  open: boolean;
  onOpenChange: Dispatch<SetStateAction<boolean>>;
  organizationId: string;
}

export default function OrganizationMemberInviteModal({
  open,
  onOpenChange,
  organizationId,
}: OrganizationInformationEditModalProps) {
  const t = useTranslations("Components.Organizations.InviteMemberModal");
  const [isLoading, setIsLoading] = useState(false);

  const handleOpenChange = (open: boolean) => {
    if (isLoading) {
      return;
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[80svh] w-[80vw] max-w-md!">
        <DialogTitle className="text-center">{t("title")}</DialogTitle>
        <DialogDescription className="hidden" />
        <OrganizationMemberInviteForm
          organizationId={organizationId}
          setIsLoading={setIsLoading}
          onOpenChange={onOpenChange}
        />
      </DialogContent>
    </Dialog>
  );
}
