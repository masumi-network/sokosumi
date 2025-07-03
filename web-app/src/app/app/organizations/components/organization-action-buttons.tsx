"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { LeaveOrganizationModal } from "@/components/organizations";
import { Button } from "@/components/ui/button";
import useModal from "@/hooks/use-modal";
import { revalidateOrganizationsPath } from "@/lib/actions";
import { authClient } from "@/lib/auth/auth.client";
import { Organization } from "@/prisma/generated/client";

interface OrganizationActionButtonsProps {
  organization: Organization;
  activeOrganizationId: string | null | undefined;
}

export default function OrganizationActionButtons({
  organization,
  activeOrganizationId,
}: OrganizationActionButtonsProps) {
  const t = useTranslations("App.Organizations.OrganizationRow");

  const { Component, showModal } = useModal(({ open, onOpenChange }) => (
    <LeaveOrganizationModal
      open={open}
      onOpenChange={onOpenChange}
      organization={organization}
    />
  ));

  const [loading, setLoading] = useState(false);

  const isActive = organization.id === activeOrganizationId;

  const handleActivate = async () => {
    if (isActive) return;
    setLoading(true);
    try {
      await authClient.organization.setActive({
        organizationId: organization.id,
      });
      await revalidateOrganizationsPath();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {isActive ? (
        <Button
          variant="outline"
          onClick={async () => {
            setLoading(true);
            try {
              await authClient.organization.setActive({ organizationId: null });
              await revalidateOrganizationsPath();
            } finally {
              setLoading(false);
            }
          }}
          disabled={loading}
        >
          {t("deactivate")}
        </Button>
      ) : (
        <Button
          variant="secondary"
          onClick={handleActivate}
          disabled={isActive || loading}
        >
          {t("activate")}
        </Button>
      )}
      <Button variant="destructive" onClick={showModal}>
        {t("leave")}
      </Button>
      {Component}
    </div>
  );
}
