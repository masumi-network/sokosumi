"use client";

import { useTranslations } from "next-intl";

import {
  OrganizationBulkInviteModal,
  OrganizationMemberInviteModal,
} from "@/components/organizations";
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

function OrganizationBulkInviteModalHost({
  open,
  onOpenChange,
  organizationId,
}: OrganizationMemberInviteModalHostProps) {
  return (
    <OrganizationBulkInviteModal
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
  const { Component: InviteMemberModal, showModal: showInviteMemberModal } =
    useModal(OrganizationMemberInviteModalHost, { organizationId });
  const { Component: BulkInviteModal, showModal: showBulkInviteModal } =
    useModal(OrganizationBulkInviteModalHost, { organizationId });

  return (
    <>
      {InviteMemberModal}
      {BulkInviteModal}
      <Button onClick={showInviteMemberModal} className={className}>
        {t("invite")}
      </Button>
      <Button
        onClick={showBulkInviteModal}
        variant="outline"
        className={className}
      >
        {t("bulkInvite")}
      </Button>
    </>
  );
}
