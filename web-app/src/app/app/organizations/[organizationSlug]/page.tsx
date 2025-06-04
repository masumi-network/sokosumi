import { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { OrganizationRoleBadge } from "@/components/organizations";
import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/auth/utils";
import { getOrganizationBySlug } from "@/lib/db";
import { findMyMemberInOrganization } from "@/lib/services";

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
    title: {
      default: t("Title.default", { name: organization.name }),
      template: t("Title.template", { name: organization.name }),
    },
    description: t("description"),
  };
}

export default async function OrganizationPage({
  params,
}: OrganizationPageProps) {
  const t = await getTranslations("App.Organizations.OrganizationDetail");

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

  return (
    <div className="container flex flex-col gap-8 p-8">
      <div className="flex items-center gap-2">
        <p className="text-muted-foreground">{t("roleIndicator")}</p>
        <OrganizationRoleBadge role={member.role} />
      </div>
      <OrganizationInformation organization={organization} member={member} />
      <Button asChild variant="secondary">
        <Link href={`/app/organizations/${organizationSlug}/members`}>
          {t("members")}
        </Link>
      </Button>
    </div>
  );
}
