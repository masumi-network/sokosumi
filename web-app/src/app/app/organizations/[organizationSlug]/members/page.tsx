import { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { MembersTable } from "@/components/members-table";
import { OrganizationRoleBadge } from "@/components/organizations";
import { getSession } from "@/lib/auth/utils";
import { getOrganizationBySlug } from "@/lib/db";
import {
  findMyMemberInOrganization,
  getOrganizationMembers,
} from "@/lib/services";

interface OrganizationMembersPageProps {
  params: Promise<{ organizationSlug: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Organizations.Members.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function OrganizationMembersPage({
  params,
}: OrganizationMembersPageProps) {
  const t = await getTranslations("App.Organizations.Members");

  const { organizationSlug } = await params;
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const organization = await getOrganizationBySlug(organizationSlug);
  if (!organization) {
    return notFound();
  }

  const member = await findMyMemberInOrganization(organization.id);
  if (!member) {
    redirect("/app/organizations");
  }

  const members = await getOrganizationMembers(organization.id);

  return (
    <div className="container flex flex-col gap-8 p-8">
      <div className="flex items-center gap-2">
        <p className="text-muted-foreground">{t("roleIndicator")}</p>
        <OrganizationRoleBadge role={member.role} />
      </div>
      <MembersTable members={members} role={member.role} />
    </div>
  );
}
