"use client";

import type { DesignMdProfileValue } from "@/components/design-md";
import { DesignMdProfileSection } from "@/components/design-md";
import type { DesignMdOwner } from "@/components/design-md/types";

import { useOrganizationMetadata } from "./organization-metadata-context";

interface OrganizationDesignMdSectionProps {
  canManage: boolean;
  owner: DesignMdOwner;
  value?: DesignMdProfileValue;
  websiteUrl?: null | string;
}

export function OrganizationDesignMdSection({
  canManage,
  owner,
  value,
  websiteUrl,
}: OrganizationDesignMdSectionProps) {
  const { updateDesignMd } = useOrganizationMetadata();

  return (
    <DesignMdProfileSection
      owner={owner}
      canManage={canManage}
      value={value}
      websiteUrl={websiteUrl}
      onValueChange={updateDesignMd}
    />
  );
}
