import { useTranslations } from "next-intl";

import { InvitationWithRelations, MemberWithOrganization } from "@/lib/db";

import InvitationRow from "./invitation-row";
import InvitationRowActionsModal from "./invitation-row-actions-modal";
import { InvitationRowActionsModalContextProvider } from "./invitation-row-actions-modal-context";
import OrganizationRow, { OrganizationRowSkeleton } from "./organization-row";

interface OrganizationsProps {
  members: MemberWithOrganization[];
  invitations: InvitationWithRelations[];
}

export default function Organizations({
  members,
  invitations,
}: OrganizationsProps) {
  if (members.length === 0 && invitations.length === 0) {
    return <OrganizationsNotAvailable />;
  }

  return (
    <InvitationRowActionsModalContextProvider>
      <div className="flex w-full flex-col divide-y rounded-lg border">
        {members.map((member) => (
          <OrganizationRow key={member.id} member={member} />
        ))}
        {invitations.map((invitation) => (
          <InvitationRow key={invitation.id} invitation={invitation} />
        ))}
      </div>
      <InvitationRowActionsModal />
    </InvitationRowActionsModalContextProvider>
  );
}

export function OrganizationsNotAvailable() {
  const t = useTranslations("App.Organizations");

  return (
    <div className="flex w-full items-center justify-center p-8">
      <p className="text-muted-foreground text-center text-base">
        {t("organizationsNotAvailable")}
      </p>
    </div>
  );
}

export function OrganizationsSkeleton() {
  return (
    <div className="flex w-full flex-col divide-y rounded-lg border">
      {[1, 2, 3].map((_, index) => (
        <OrganizationRowSkeleton key={index} />
      ))}
    </div>
  );
}
