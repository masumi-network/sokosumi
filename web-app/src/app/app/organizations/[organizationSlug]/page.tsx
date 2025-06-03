import { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { getSession } from "@/lib/auth/utils";
import { getOrganizationBySlug } from "@/lib/db";
import { findMemberInOrganization } from "@/lib/services";

import OrganizationInformation from "./components/organization-information";

interface OrganizationPageProps {
  params: Promise<{ organizationSlug: string }>;
}

export async function generateMetadata({
  params,
}: OrganizationPageProps): Promise<Metadata> {
  const t = await getTranslations(
    "App.Organizations.OrganizationDetail.Metadata",
  );

  const { organizationSlug } = await params;
  const organization = await getOrganizationBySlug(organizationSlug);
  if (!organization) {
    return notFound();
  }

  return {
    title: t("title", { name: organization.name }),
    description: t("description"),
  };
}

export default async function OrganizationPage({
  params,
}: OrganizationPageProps) {
  const { organizationSlug } = await params;

  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const organization = await getOrganizationBySlug(organizationSlug);
  if (!organization) {
    return notFound();
  }

  const member = await findMemberInOrganization(organization.id);
  if (!member) {
    redirect("/app/organizations");
  }

  return (
    <div className="container flex flex-col gap-8 p-8">
      <OrganizationInformation organization={organization} member={member} />
    </div>
  );
}
