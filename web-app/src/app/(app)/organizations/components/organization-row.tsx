import { Building2 } from "lucide-react";
import Link from "next/link";

import {
  OrganizationLogo,
  OrganizationRoleBadge,
} from "@/components/organizations";
import { Skeleton } from "@/components/ui/skeleton";
import { MemberWithOrganization } from "@/lib/db";

import OrganizationActionButtons from "./organization-action-buttons";

export default function OrganizationRow({
  member,
}: {
  member: MemberWithOrganization;
}) {
  const { organization, role } = member;
  const { slug, name } = organization;

  return (
    <div className="flex items-center justify-between p-4">
      <div className="flex items-center gap-4">
        <OrganizationLogo organization={organization} size={24} />
        <Link href={`/app/organizations/${slug}`}>
          <p className="text-primary text-lg hover:underline">{name}</p>
        </Link>
        <OrganizationRoleBadge role={role} />
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
