import { Building2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { OrganizationLogo } from "@/components/organizations";
import { Skeleton } from "@/components/ui/skeleton";
import { MemberRole, OrganizationWithRelations } from "@/lib/db";
import { Member } from "@/prisma/generated/client";

import OrganizationEditButton from "./organization-edit-button";
import OrganizationRemoveButton from "./organization-remove-button";

interface OrganizationInformationProps {
  organization: OrganizationWithRelations;
  member: Member;
}

export default function OrganizationInformation({
  organization,
  member,
}: OrganizationInformationProps) {
  const t = useTranslations("App.Organizations.OrganizationDetail");

  const { name } = organization;
  const { role } = member;
  const isOwnerOrAdmin = role === MemberRole.OWNER || role === MemberRole.ADMIN;

  return (
    <div className="flex items-center gap-8 lg:gap-12">
      <OrganizationLogo organization={organization} size={96} />
      <div className="flex flex-1 flex-col justify-between self-stretch">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-light">{t("title", { name })}</h1>
        </div>
      </div>
      {isOwnerOrAdmin && (
        <div className="flex items-start gap-2 self-stretch">
          <OrganizationEditButton organization={organization} />
          <OrganizationRemoveButton organization={organization} />
        </div>
      )}
    </div>
  );
}

export function OrganizationInformationSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-20" />
      </div>
      <div className="flex items-center gap-8 lg:gap-12">
        <Building2 size={96} />
        <div className="flex flex-1 flex-col justify-between self-stretch">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
      <Skeleton className="h-4 w-20" />
    </div>
  );
}
