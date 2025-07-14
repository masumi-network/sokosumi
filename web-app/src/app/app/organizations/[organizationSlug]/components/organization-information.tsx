import { Building2 } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  OrganizationLogo,
  RequiredEmailDomains,
  RequiredEmailDomainsSkeleton,
} from "@/components/organizations";
import { Skeleton } from "@/components/ui/skeleton";
import { MemberRole, OrganizationWithRelations } from "@/lib/db";
import { Member } from "@/prisma/generated/client";

import OrganizationEditButton from "./organization-edit-button";

interface OrganizationInformationProps {
  organization: OrganizationWithRelations;
  member: Member;
}

export default function OrganizationInformation({
  organization,
  member,
}: OrganizationInformationProps) {
  const t = useTranslations("App.Organizations.OrganizationDetail");

  const { name, metadata, requiredEmailDomains } = organization;
  const { role } = member;
  const isAdmin = role === MemberRole.ADMIN;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center gap-8 lg:gap-12">
        <OrganizationLogo organization={organization} size={96} />
        <div className="flex flex-1 flex-col justify-center self-stretch">
          <h1 className="text-2xl font-light">{t("title", { name: name })}</h1>
          {metadata && (
            <p className="text-muted-foreground mt-auto line-clamp-2 text-sm">
              {metadata}
            </p>
          )}
        </div>
        {isAdmin && (
          <div className="self-stretch">
            <OrganizationEditButton organization={organization} />
          </div>
        )}
      </div>
      <div>
        <span className="text-muted-foreground mr-2 text-sm">
          {t("requiredEmailDomains")}
        </span>
        <RequiredEmailDomains
          requiredEmailDomains={requiredEmailDomains}
          className="mt-2"
        />
      </div>
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
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-20" />
        <RequiredEmailDomainsSkeleton />
      </div>
    </div>
  );
}
