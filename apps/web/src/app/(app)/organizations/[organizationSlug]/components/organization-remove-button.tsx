"use client";

import type {
  OrganizationDeletionEvaluation,
  OrganizationRecord,
} from "@sokosumi/core-client";
import { Trash } from "lucide-react";
import { useTranslations } from "next-intl";
import OrganizationRemoveModal from "@/components/organizations/organization-remove/modal";
import { Button } from "@/components/ui/button";
import useModal from "@/hooks/use-modal";

interface OrganizationRemoveButtonProps {
  organization: OrganizationRecord;
  className?: string | undefined;
  blockers?: OrganizationDeletionEvaluation["blockers"];
  preflightFailed?: boolean;
  otherMemberCount?: number;
}

export default function OrganizationRemoveButton({
  organization,
  className,
  blockers = [],
  preflightFailed = false,
  otherMemberCount = 0,
}: OrganizationRemoveButtonProps) {
  const t = useTranslations("App.Organizations.OrganizationDetail");
  const { Component, showModal } = useModal(OrganizationRemoveModal, {
    organization,
    blockers,
    preflightFailed,
    otherMemberCount,
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
