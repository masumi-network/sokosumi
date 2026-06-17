import { getOrganizationMetadata, resolveIpfsOrHttpUrl } from "@sokosumi/utils";
import { Building2 } from "lucide-react";
import Image from "next/image";
import { Favicon } from "@/components/ui/favicon";
import type { OrganizationRecord } from "@/lib/clients/generated/core";
import { buildFaviconCandidates } from "@/lib/utils/url";

interface OrganizationLogoProps {
  organization: OrganizationRecord;
  size?: number | undefined;
}

export function OrganizationLogo({
  organization,
  size = 24,
}: OrganizationLogoProps) {
  const { name, logo } = organization;
  const { url } = getOrganizationMetadata(organization.metadata);

  if (logo) {
    return (
      <Image
        src={resolveIpfsOrHttpUrl(logo)}
        alt={name}
        width={size * 3}
        height={size * 3}
        className="size-full rounded-sm object-cover"
      />
    );
  }

  const faviconSources = url ? buildFaviconCandidates(url) : [];
  if (url && faviconSources.length > 0) {
    return (
      <Favicon
        sources={faviconSources}
        alt={name}
        size={size}
        className="size-full rounded-sm"
        fallback={<Building2 size={size} />}
      />
    );
  }

  return <Building2 size={size} />;
}
