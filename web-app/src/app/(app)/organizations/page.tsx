import { Metadata } from "next";
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
  const t = await getTranslations("App.Organizations");

  const members = await userService.getMyMembersWithOrganizations();
  const invitations = await userService.getMyValidPendingInvitations();

  return (
    <div className="container flex flex-col gap-8 md:p-8">
      <div className="flex w-full items-center justify-between">
        <h1 className="text-2xl font-light">{t("title")}</h1>
        <OrganizationCreateButton />
      </div>
      <Organizations members={members} invitations={invitations} />
    </div>
  );
}
