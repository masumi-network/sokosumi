import { Organization } from "@sokosumi/database";
import { Building2 } from "lucide-react";
import Image from "next/image";

import { Favicon } from "@/components/ui/favicon";
import { ipfsUrlResolver } from "@/lib/ipfs";
import { buildFaviconCandidates } from "@/lib/utils/url";

interface OrganizationLogoProps {
  organization: Organization;
  size?: number | undefined;
}

export function OrganizationLogo({
  organization,
  size = 24,
}: OrganizationLogoProps) {
  const { name, logo, url } = organization;

  if (logo) {
    return (
      <Image
        src={ipfsUrlResolver(logo)}
        alt={name}
        width={size}
        height={size}
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
