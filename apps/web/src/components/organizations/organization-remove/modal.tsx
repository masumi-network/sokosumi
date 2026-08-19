"use client";

import { useTranslations } from "next-intl";
import { type Dispatch, type SetStateAction, useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { OrganizationRecord } from "@/lib/clients/generated/core";

import OrganizationRemoveForm from "./form";

interface OrganizationRemoveModalProps {
  open: boolean;
  onOpenChange: Dispatch<SetStateAction<boolean>>;
  organization: OrganizationRecord;
  blockers?: string[];
  preflightFailed?: boolean;
}

export default function OrganizationRemoveModal({
  open,
  onOpenChange,
  organization,
  blockers = [],
  preflightFailed = false,
}: OrganizationRemoveModalProps) {
  const t = useTranslations("Components.Organizations.RemoveModal");
  const [isLoading, setIsLoading] = useState(false);

  const handleOpenChange = (open: boolean) => {
    if (isLoading) {
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
        <OrganizationRemoveForm
          organization={organization}
          setIsLoading={setIsLoading}
          onOpenChange={onOpenChange}
          blockers={blockers}
          preflightFailed={preflightFailed}
        />
      </AlertDialogContent>
    </AlertDialog>
  );
}
