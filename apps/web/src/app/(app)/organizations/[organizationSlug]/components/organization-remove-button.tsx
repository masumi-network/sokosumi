"use client";

import { Trash } from "lucide-react";
import { useTranslations } from "next-intl";

import { OrganizationRemoveModal } from "@/components/organizations";
import { Button } from "@/components/ui/button";
import useModal from "@/hooks/use-modal";
import { Organization } from "@/prisma/generated/client";

interface OrganizationRemoveButtonProps {
  organization: Organization;
}

export default function OrganizationRemoveButton({
  organization,
}: OrganizationRemoveButtonProps) {
  const t = useTranslations("App.Organizations.OrganizationDetail");
  const { Component, showModal } = useModal(({ open, onOpenChange }) => (
    <OrganizationRemoveModal
      open={open}
      onOpenChange={onOpenChange}
      organization={organization}
    />
  ));

  return (
    <>
      {Component}
      <Button variant="destructive" onClick={showModal}>
        <Trash size={16} />
        {t("delete")}
      </Button>
    </>
  );
}
