"use client";

import { Trash } from "lucide-react";
import { useTranslations } from "next-intl";
import { OrganizationRemoveModal } from "@/components/organizations";
import { Button } from "@/components/ui/button";
import useModal from "@/hooks/use-modal";
import type { OrganizationRecord } from "@/lib/clients/generated/core";

interface OrganizationRemoveButtonProps {
  organization: OrganizationRecord;
  className?: string | undefined;
}

interface OrganizationRemoveModalHostProps {
  open: boolean;
  onOpenChange: React.Dispatch<React.SetStateAction<boolean>>;
  organization: OrganizationRecord;
}

function OrganizationRemoveModalHost({
  open,
  onOpenChange,
  organization,
}: OrganizationRemoveModalHostProps) {
  return (
    <OrganizationRemoveModal
      open={open}
      onOpenChange={onOpenChange}
      organization={organization}
    />
  );
}

export default function OrganizationRemoveButton({
  organization,
  className,
}: OrganizationRemoveButtonProps) {
  const t = useTranslations("App.Organizations.OrganizationDetail");
  const { Component, showModal } = useModal(OrganizationRemoveModalHost, {
    organization,
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
