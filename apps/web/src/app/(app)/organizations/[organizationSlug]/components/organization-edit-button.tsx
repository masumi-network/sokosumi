"use client";

import { Organization } from "@sokosumi/database";
import { Pencil } from "lucide-react";
import { useTranslations } from "next-intl";

import { OrganizationInformationModal } from "@/components/organizations";
import { Button } from "@/components/ui/button";
import useModal from "@/hooks/use-modal";

interface OrganizationEditButtonProps {
  organization: Organization;
}

export default function OrganizationEditButton({
  organization,
}: OrganizationEditButtonProps) {
  const t = useTranslations("App.Organizations.OrganizationDetail");
  const { Component, showModal } = useModal(({ open, onOpenChange }) => (
    <OrganizationInformationModal
      open={open}
      onOpenChange={onOpenChange}
      organization={organization}
    />
  ));

  return (
    <>
      {Component}
      <Button onClick={showModal}>
        <Pencil size={16} />
        {t("edit")}
      </Button>
    </>
  );
}
