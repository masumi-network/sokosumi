"use client";

import type { DesignMdProfileValue } from "@/components/design-md";
import { DesignMdProfileSection } from "@/components/design-md";
import type { ManageableDesignMdOwner } from "@/components/design-md/types";

import { useOrganizationMetadata } from "./organization-metadata-context";

interface OrganizationDesignMdSectionProps {
  canManage: boolean;
  editHref?: null | string;
  owner: ManageableDesignMdOwner;
  value?: DesignMdProfileValue;
  websiteUrl?: null | string;
}

export function OrganizationDesignMdSection({
  canManage,
  editHref,
  owner,
  value,
  websiteUrl,
}: OrganizationDesignMdSectionProps) {
  const { updateDesignMd } = useOrganizationMetadata();

  return (
    <DesignMdProfileSection
      owner={owner}
      canManage={canManage}
      editHref={editHref}
      value={value}
      websiteUrl={websiteUrl}
      onValueChange={updateDesignMd}
    />
  );
}
