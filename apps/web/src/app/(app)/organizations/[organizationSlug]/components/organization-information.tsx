import {
  Member,
  MemberRole,
  OrganizationWithRelations,
} from "@sokosumi/database";

import { OrganizationLogo } from "@/components/organizations";

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
  const { role } = member;
  const isOwnerOrAdmin = role === MemberRole.OWNER || role === MemberRole.ADMIN;

  return (
    <div className="flex items-center gap-8 lg:gap-12">
      <OrganizationLogo organization={organization} />
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
  );
}
