"use client";

import { Organization } from "@sokosumi/database";
import { useTranslations } from "next-intl";

import { LeaveOrganizationModal } from "@/components/organizations";
import { Button } from "@/components/ui/button";
import useModal from "@/hooks/use-modal";

interface OrganizationActionButtonsProps {
  organization: Organization;
}

export default function OrganizationActionButtons({
  organization,
}: OrganizationActionButtonsProps) {
  const t = useTranslations("App.Organizations.OrganizationRow");

  const { Component, showModal } = useModal(({ open, onOpenChange }) => (
    <LeaveOrganizationModal
      open={open}
      onOpenChange={onOpenChange}
      organization={organization}
    />
  ));

  return (
    <div className="flex items-center gap-2">
      <Button variant="destructive" onClick={showModal}>
        {t("leave")}
      </Button>
      {Component}
    </div>
  );
}
