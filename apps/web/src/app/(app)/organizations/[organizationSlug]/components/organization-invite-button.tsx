"use client";

import { useTranslations } from "next-intl";

import OrganizationBulkInviteModal from "@/components/organizations/organization-bulk-invite/modal";
import OrganizationMemberInviteModal from "@/components/organizations/organization-member-invite/modal";
import { Button } from "@/components/ui/button";
import useModal from "@/hooks/use-modal";

interface OrganizationInviteButtonProps {
  organizationId: string;
  className?: string | undefined;
}

export default function OrganizationInviteButton({
  organizationId,
  className,
}: OrganizationInviteButtonProps) {
  const t = useTranslations("App.Organizations.OrganizationDetail");
  const { Component: InviteMemberModal, showModal: showInviteMemberModal } =
    useModal(OrganizationMemberInviteModal, { organizationId });
  const { Component: BulkInviteModal, showModal: showBulkInviteModal } =
    useModal(OrganizationBulkInviteModal, { organizationId });

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
