"use client";

import type { Organization } from "@sokosumi/database";
import { useTranslations } from "next-intl";

import { LeaveOrganizationModal } from "@/components/organizations";
import { Button } from "@/components/ui/button";
import useModal from "@/hooks/use-modal";

interface OrganizationActionButtonsProps {
  organization: Organization;
}

interface LeaveOrganizationModalHostProps {
  open: boolean;
  onOpenChange: React.Dispatch<React.SetStateAction<boolean>>;
  organization: Organization;
}

function LeaveOrganizationModalHost({
  open,
  onOpenChange,
  organization,
}: LeaveOrganizationModalHostProps) {
  return (
    <LeaveOrganizationModal
      open={open}
      onOpenChange={onOpenChange}
      organization={organization}
    />
  );
}

export default function OrganizationActionButtons({
  organization,
}: OrganizationActionButtonsProps) {
  const t = useTranslations("App.Organizations.OrganizationRow");

  const { Component, showModal } = useModal(LeaveOrganizationModalHost, {
    organization,
  });

  return (
    <div className="flex items-center gap-2">
      <Button variant="destructive" onClick={showModal}>
        {t("leave")}
      </Button>
      {Component}
    </div>
  );
}
