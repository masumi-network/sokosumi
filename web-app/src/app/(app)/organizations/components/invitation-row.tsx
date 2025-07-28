import { Building2 } from "lucide-react";
import Link from "next/link";

import {
  OrganizationLogo,
  OrganizationRoleBadge,
} from "@/components/organizations";
import { Skeleton } from "@/components/ui/skeleton";
import { InvitationWithRelations } from "@/lib/db";

import InvitationRowActionButtons from "./invitation-row-action-buttons";

export default function InvitationRow({
  invitation,
}: {
  invitation: InvitationWithRelations;
}) {
  const { organization, role } = invitation;
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
      <InvitationRowActionButtons invitation={invitation} />
    </div>
  );
}

export function InvitationRowSkeleton() {
  return (
    <div className="flex items-center justify-between p-4">
      <div className="flex items-center gap-4">
        <Building2 size={24} />
        <div>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-1 h-3 w-16" />
        </div>
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="h-8 w-16" />
        <Skeleton className="h-8 w-16" />
      </div>
    </div>
  );
}
