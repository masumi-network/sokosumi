"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { OrganizationInformationModal } from "@/components/organizations";
import { Button } from "@/components/ui/button";
import useModal from "@/hooks/use-modal";

interface OrganizationCreateButtonProps {
  className?: string | undefined;
}

export default function OrganizationCreateButton({
  className,
}: OrganizationCreateButtonProps) {
  const t = useTranslations("App.Organizations");
  const { Component, showModal } = useModal(({ open, onOpenChange }) => (
    <OrganizationInformationModal
      open={open}
      onOpenChange={onOpenChange}
      organization={null}
    />
  ));

  return (
    <>
      {Component}
      <Button variant="primary" onClick={showModal} className={className}>
        <Plus size={16} />
        {t("newOrganization")}
      </Button>
    </>
  );
}
