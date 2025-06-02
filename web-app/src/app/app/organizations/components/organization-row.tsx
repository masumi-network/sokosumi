import { Building2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { Skeleton } from "@/components/ui/skeleton";
import { MemberWithOrganization } from "@/lib/db";
import { ipfsUrlResolver } from "@/lib/ipfs";

import OrganizationActionButtons from "./organization-action-buttons";
import RoleBadge from "./role-badge";

export default function OrganizationRow({
  member,
}: {
  member: MemberWithOrganization;
}) {
  const { organization, role } = member;
  const { slug, name, logo } = organization;

  return (
    <div className="flex items-center justify-between p-4">
      <div className="flex items-center gap-4">
        {logo ? (
          <Image
            src={ipfsUrlResolver(logo)}
            alt={name}
            width={24}
            height={24}
          />
        ) : (
          <Building2 size={24} />
        )}
        <Link href={`/app/organizations/${slug}`}>
          <p className="text-primary text-lg font-medium hover:underline">
            {name}
          </p>
        </Link>
        <RoleBadge role={role} />
      </div>
      <OrganizationActionButtons organization={organization} />
    </div>
  );
}

export function OrganizationRowSkeleton() {
  return (
    <div className="flex items-center justify-between p-4">
      <div className="flex items-center gap-4">
        <Building2 size={24} />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="h-8 w-24" />
      </div>
    </div>
  );
}
