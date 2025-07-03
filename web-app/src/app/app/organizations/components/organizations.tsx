import { useTranslations } from "next-intl";

import { getSession } from "@/lib/auth/utils";
import { MemberWithOrganization } from "@/lib/db";

import OrganizationRow, { OrganizationRowSkeleton } from "./organization-row";

interface OrganizationsProps {
  members: MemberWithOrganization[];
}

export default async function Organizations({ members }: OrganizationsProps) {
  const session = await getSession();
  const activeOrganizationId =
    session?.session.activeOrganizationId ?? undefined;
  if (members.length === 0) {
    return <OrganizationsNotAvailable />;
  }

  return (
    <div className="flex w-full flex-col divide-y rounded-lg border">
      {members.map((member) => (
        <OrganizationRow
          key={member.id}
          member={member}
          activeOrganizationId={activeOrganizationId}
        />
      ))}
    </div>
  );
}

export function OrganizationsNotAvailable() {
  const t = useTranslations("App.Organizations");

  return (
    <div className="flex w-full items-center justify-center p-8">
      <p className="text-muted-foreground text-center text-base">
        {t("membersNotAvailable")}
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
