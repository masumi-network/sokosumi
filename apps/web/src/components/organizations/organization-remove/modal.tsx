"use client";

import type {
  OrganizationDeletionEvaluation,
  OrganizationRecord,
} from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { type Dispatch, type SetStateAction, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { OrganizationRemoveBlocked } from "./blocked";
import OrganizationRemoveForm from "./form";

interface OrganizationRemoveModalProps {
  open: boolean;
  onOpenChange: Dispatch<SetStateAction<boolean>>;
  organization: OrganizationRecord;
  blockers?: OrganizationDeletionEvaluation["blockers"];
  preflightFailed?: boolean;
  otherMemberCount?: number;
  isActiveOrganization?: boolean;
}

export default function OrganizationRemoveModal({
  open,
  onOpenChange,
  organization,
  blockers = [],
  preflightFailed = false,
  otherMemberCount = 0,
  isActiveOrganization = false,
}: OrganizationRemoveModalProps) {
  const t = useTranslations("Components.Organizations.RemoveModal");
  const [isLoading, setIsLoading] = useState(false);
  // Set by "Go to members" so closing lands on the members card, not the Delete button.
  const focusMembers = useRef(false);

  const handleOpenChange = (open: boolean) => {
    if (isLoading) {
      return;
    }
    onOpenChange(open);
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent
        className="w-md"
        onCloseAutoFocus={(event) => {
          const members = focusMembers.current
            ? document.getElementById("members")
            : null;
          focusMembers.current = false;
          if (!members) return;
          event.preventDefault();
          members.focus({ preventScroll: true });
          members.scrollIntoView({ block: "start" });
        }}
      >
        {blockers.length > 0 && !preflightFailed ? (
          <OrganizationRemoveBlocked
            organization={organization}
            blockers={blockers}
            otherMemberCount={otherMemberCount}
            isActiveOrganization={isActiveOrganization}
            onGoToMembers={() => {
              focusMembers.current = true;
              onOpenChange(false);
            }}
          />
        ) : (
          <>
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
              preflightFailed={preflightFailed}
            />
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
