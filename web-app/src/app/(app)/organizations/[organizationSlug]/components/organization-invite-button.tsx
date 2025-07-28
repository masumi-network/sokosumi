"use client";

import { useTranslations } from "next-intl";

import { OrganizationMemberInviteModal } from "@/components/organizations";
import { Button } from "@/components/ui/button";
import useModal from "@/hooks/use-modal";

interface OrganizationInviteButtonProps {
  organizationId: string;
}

export default function OrganizationInviteButton({
  organizationId,
}: OrganizationInviteButtonProps) {
  const t = useTranslations("App.Organizations.OrganizationDetail");
  const { Component, showModal } = useModal(({ open, onOpenChange }) => (
    <OrganizationMemberInviteModal
      open={open}
      onOpenChange={onOpenChange}
      organizationId={organizationId}
    />
  ));

  return (
    <>
      {Component}
      <Button onClick={showModal}>{t("invite")}</Button>
    </>
  );
}
