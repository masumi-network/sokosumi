import { Building2 } from "lucide-react";
import Image from "next/image";

import { ipfsUrlResolver } from "@/lib/ipfs";
import { Organization } from "@/prisma/generated/client";

interface OrganizationLogoProps {
  organization: Organization;
  size?: number | undefined;
}

export function OrganizationLogo({
  organization,
  size = 24,
}: OrganizationLogoProps) {
  const { name, logo } = organization;

  if (!logo) {
    return <Building2 size={size} />;
  }

  return (
    <Image src={ipfsUrlResolver(logo)} alt={name} width={size} height={size} />
  );
}
