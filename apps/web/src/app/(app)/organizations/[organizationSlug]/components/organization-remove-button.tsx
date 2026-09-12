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

export default function OrganizationRemoveButton({
  organization,
  className,
  blockers = [],
  preflightFailed = false,
}: OrganizationRemoveButtonProps) {
  const t = useTranslations("App.Organizations.OrganizationDetail");
  const { Component, showModal } = useModal(OrganizationRemoveModal, {
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
