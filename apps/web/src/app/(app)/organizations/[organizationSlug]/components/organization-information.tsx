import {
  Member,
  MemberRole,
  OrganizationWithRelations,
} from "@sokosumi/database";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { OrganizationLogo } from "@/components/organizations";
import { Avatar } from "@/components/ui/avatar";

import OrganizationEditButton from "./organization-edit-button";
import OrganizationRemoveButton from "./organization-remove-button";

interface OrganizationInformationProps {
  organization: OrganizationWithRelations;
  member: Member;
}

export default async function OrganizationInformation({
  organization,
  member,
}: OrganizationInformationProps) {
  const t = await getTranslations("App.Organizations.OrganizationDetail");
  const { role } = member;
  const isOwnerOrAdmin = role === MemberRole.OWNER || role === MemberRole.ADMIN;
  const websiteUrl = organization.url?.trim() ?? null;
  const hasWebsite = Boolean(websiteUrl);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-8 lg:gap-12">
        <Avatar className="bg-muted size-6 items-center justify-center">
          <OrganizationLogo organization={organization} size={24} />
        </Avatar>
        <div className="flex-1" />
        {isOwnerOrAdmin && (
          <div className="flex items-center gap-1.5 self-start">
            <OrganizationEditButton
              organization={organization}
              className="h-7 gap-1.5 px-2 text-xs"
            />
            <OrganizationRemoveButton
              organization={organization}
              className="h-7 gap-1.5 px-2 text-xs"
            />
          </div>
        )}
      </div>
      {hasWebsite && (
        <div className="text-sm">
          <span className="text-muted-foreground mr-2">
            {t("websiteLabel")}:
          </span>
          <Link
            href={websiteUrl as string}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline-offset-4 hover:underline"
          >
            {websiteUrl}
          </Link>
        </div>
      )}
    </div>
  );
}
