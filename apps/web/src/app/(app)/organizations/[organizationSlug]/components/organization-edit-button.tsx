"use client";

import type { Organization } from "@sokosumi/database";
import { Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { OrganizationInformationModal } from "@/components/organizations";
import { Button } from "@/components/ui/button";

import { useOrganizationMetadata } from "./organization-metadata-context";

interface OrganizationEditButtonProps {
  organization: Organization;
  className?: string | undefined;
}

export default function OrganizationEditButton({
  organization,
  className,
}: OrganizationEditButtonProps) {
  const t = useTranslations("App.Organizations.OrganizationDetail");
  const [open, setOpen] = useState(false);
  const { metadata } = useOrganizationMetadata();

  return (
    <>
      <OrganizationInformationModal
        open={open}
        onOpenChange={setOpen}
        organization={organization}
        organizationMetadata={metadata}
      />
      <Button onClick={() => setOpen(true)} className={className}>
        <Pencil size={16} />
        {t("edit")}
      </Button>
    </>
  );
}
