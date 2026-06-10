"use client";

import type { Organization } from "@sokosumi/database";
import { useTranslations } from "next-intl";
import { type Dispatch, type SetStateAction, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

import OrganizationInformationForm from "./form";

interface OrganizationInformationModalProps {
  open: boolean;
  onOpenChange: Dispatch<SetStateAction<boolean>>;
  organization: Organization | null;
  organizationMetadata?: string | null;
}

export default function OrganizationInformationModal({
  open,
  onOpenChange,
  organization,
  organizationMetadata,
}: OrganizationInformationModalProps) {
  const t = useTranslations("Components.Organizations.InformationModal.Title");
  const [isLoading, setIsLoading] = useState(false);
  const [isLogoUploadInFlight, setIsLogoUploadInFlight] = useState(false);

  const handleOpenChange = (nextOpen: boolean) => {
    if (isLoading || isLogoUploadInFlight) {
      return;
    }
    onOpenChange(nextOpen);
  };

  const isCreating = !organization;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90svh] w-[95vw] max-w-lg! overflow-y-auto sm:w-[85vw] sm:max-w-xl md:w-[70vw] md:max-w-2xl!">
        <DialogTitle className="text-center">
          {isCreating ? t("create") : t("edit")}
        </DialogTitle>
        <DialogDescription className="hidden" />
        <OrganizationInformationForm
          key={
            organization
              ? `${organization.id}:${organizationMetadata ?? organization.metadata ?? ""}`
              : "create"
          }
          organization={organization}
          organizationMetadata={organizationMetadata}
          setIsLoading={setIsLoading}
          onLogoUploadBusyChange={setIsLogoUploadInFlight}
          onOpenChange={onOpenChange}
        />
      </DialogContent>
    </Dialog>
  );
}
