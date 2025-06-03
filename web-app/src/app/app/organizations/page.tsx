import { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { listMyMembers } from "@/lib/actions";

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

  const members = await listMyMembers();
  if (!members) {
    redirect("/login");
  }

  return (
    <div className="container flex flex-col gap-8 p-8">
      <div className="flex w-full items-center justify-between">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
      </div>
      <Organizations members={members} />
    </div>
  );
}
