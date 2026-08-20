"use client";

import { Trash } from "lucide-react";
import { useTranslations } from "next-intl";
import { OrganizationRemoveModal } from "@/components/organizations";
import { Button } from "@/components/ui/button";
import useModal from "@/hooks/use-modal";
import type {
  OrganizationDeletionEvaluation,
  OrganizationRecord,
} from "@/lib/clients/generated/core";

interface OrganizationRemoveButtonProps {
  organization: OrganizationRecord;
  className?: string | undefined;
  blockers?: OrganizationDeletionEvaluation["blockers"];
  preflightFailed?: boolean;
}

interface OrganizationRemoveModalHostProps {
  open: boolean;
  onOpenChange: React.Dispatch<React.SetStateAction<boolean>>;
  organization: OrganizationRecord;
  blockers?: OrganizationDeletionEvaluation["blockers"];
  preflightFailed?: boolean;
}

function OrganizationRemoveModalHost({
  open,
  onOpenChange,
  organization,
  blockers = [],
  preflightFailed = false,
}: OrganizationRemoveModalHostProps) {
  return (
    <OrganizationRemoveModal
      open={open}
      onOpenChange={onOpenChange}
      organization={organization}
      blockers={blockers}
      preflightFailed={preflightFailed}
    />
  );
}

export default function OrganizationRemoveButton({
  organization,
  className,
  blockers = [],
  preflightFailed = false,
}: OrganizationRemoveButtonProps) {
  const t = useTranslations("App.Organizations.OrganizationDetail");
  const { Component, showModal } = useModal(OrganizationRemoveModalHost, {
    organization,
    blockers,
    preflightFailed,
  });

  return (
    <>
      {Component}
      <Button variant="destructive" onClick={showModal} className={className}>
        <Trash size={16} />
        {t("delete")}
      </Button>
    </>
  );
}
