import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { userService } from "@/lib/services";

import OrganizationCreateButton from "./components/organization-create-button";
import Organizations from "./components/organizations";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Organizations.Metadata");
  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function OrganizationsPage() {
  const members = await userService.getMyMembersWithOrganizations();
  const invitations = await userService.getMyValidPendingInvitations();

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-4xl space-y-12 px-4">
        <div className="flex w-full items-center justify-between">
          <div />
          <div className="flex items-center gap-1.5">
            <OrganizationCreateButton className="h-7 gap-1.5 px-2.5 text-xs" />
          </div>
        </div>
        <Organizations members={members} invitations={invitations} />
      </div>
    </div>
  );
}
