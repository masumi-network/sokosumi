"use client";

import { useTranslations } from "next-intl";

import { OrganizationMemberInviteModal } from "@/components/organizations";
import { Button } from "@/components/ui/button";
import useModal from "@/hooks/use-modal";

interface OrganizationInviteButtonProps {
  organizationId: string;
  className?: string | undefined;
}

interface OrganizationMemberInviteModalHostProps {
  open: boolean;
  onOpenChange: React.Dispatch<React.SetStateAction<boolean>>;
  organizationId: string;
}

function OrganizationMemberInviteModalHost({
  open,
  onOpenChange,
  organizationId,
}: OrganizationMemberInviteModalHostProps) {
  return (
    <OrganizationMemberInviteModal
      open={open}
      onOpenChange={onOpenChange}
      organizationId={organizationId}
    />
  );
}

export default function OrganizationInviteButton({
  organizationId,
  className,
}: OrganizationInviteButtonProps) {
  const t = useTranslations("App.Organizations.OrganizationDetail");
  const { Component, showModal } = useModal(OrganizationMemberInviteModalHost, {
    organizationId,
  });

  return (
    <>
      {Component}
      <Button onClick={showModal} className={className}>
        {t("invite")}
      </Button>
    </>
  );
}
