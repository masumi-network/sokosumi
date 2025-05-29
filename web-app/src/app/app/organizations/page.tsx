import { getTranslations } from "next-intl/server";

import { requireAuthentication } from "@/lib/auth/utils";
import { listMembers } from "@/lib/db";

import Members from "./components/Members";

export default async function OrganizationsPage() {
  const t = await getTranslations("App.Organizations");

  const { session } = await requireAuthentication();
  const userId = session.user.id;
  const members = await listMembers(userId);

  return (
    <div className="flex flex-col items-center justify-center gap-8 p-8">
      <div className="flex w-full items-center justify-between">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
      </div>
      <div className="container mx-auto">
        <Members members={members} />
      </div>
    </div>
  );
}
