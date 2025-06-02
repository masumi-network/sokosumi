import { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { getSession } from "@/lib/auth/utils";
import { getOrganizationBySlug } from "@/lib/db";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations(
    "App.Organizations.OrganizationDetail.Metadata",
  );
  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function OrganizationPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const t = await getTranslations("App.Organizations.OrganizationDetail");
  const { organizationSlug } = await params;

  const session = await getSession();
  if (!session) {
    return redirect("/login");
  }
  const userId = session.user.id;

  const organization = await getOrganizationBySlug(organizationSlug);
  if (!organization) {
    return notFound();
  }

  const inOrganization = organization.members.some(
    (member) => member.userId == userId,
  );
  if (!inOrganization) {
    return redirect("/app/organizations");
  }

  return (
    <div className="flex flex-col items-center justify-center gap-8 p-8">
      <h1 className="text-2xl font-bold">
        {t("title", { name: organization.name })}
      </h1>
    </div>
  );
}
