import { Organization } from "@sokosumi/database";
import { resolveIpfsOrHttpUrl } from "@sokosumi/utils";
import { Building2 } from "lucide-react";
import Image from "next/image";

import { Favicon } from "@/components/ui/favicon";
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
        src={resolveIpfsOrHttpUrl(logo)}
        alt={name}
        width={size}
        height={size}
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
