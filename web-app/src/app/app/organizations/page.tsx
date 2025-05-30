import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { listMyMembers } from "@/lib/actions";

import Organizations from "./components/organizations";

export default async function OrganizationsPage() {
  const t = await getTranslations("App.Organizations");

  const members = await listMyMembers();
  if (!members) {
    redirect("/login");
  }

  return (
    <div className="flex flex-col items-center justify-center gap-8 p-8">
      <div className="flex w-full items-center justify-between">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
      </div>
      <div className="container mx-auto">
        <Organizations members={members} />
      </div>
    </div>
  );
}
