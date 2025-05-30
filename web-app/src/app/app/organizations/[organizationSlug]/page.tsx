import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { getSession } from "@/lib/auth/utils";
import { getOrganizationBySlug } from "@/lib/db";

export default async function OrganizationPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const t = await getTranslations("App.Organizations");
  const { organizationSlug } = await params;

  const session = await getSession();
  if (!session) {
    return redirect("/login");
  }

  const organization = await getOrganizationBySlug(organizationSlug);
  if (!organization) {
    return notFound();
  }

  return <div>{t("title")}</div>;
}
