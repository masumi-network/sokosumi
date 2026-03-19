"use client";

import { Organization } from "@sokosumi/database";
import { useTranslations } from "next-intl";
import { Dispatch, SetStateAction, useState } from "react";

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
}

export default function OrganizationInformationModal({
  open,
  onOpenChange,
  organization,
}: OrganizationInformationModalProps) {
  const t = useTranslations("Components.Organizations.InformationModal.Title");
  const [isLoading, setIsLoading] = useState(false);

  const handleOpenChange = (open: boolean) => {
    if (isLoading) {
      return;
    }
    onOpenChange(open);
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
          organization={organization}
          setIsLoading={setIsLoading}
          onOpenChange={onOpenChange}
        />
      </DialogContent>
    </Dialog>
  );
}
