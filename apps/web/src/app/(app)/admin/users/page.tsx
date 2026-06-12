import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { UserList } from "@/components/admin/users/user-list";
import { adminUserService } from "@/lib/services/admin-user.service";

export const metadata: Metadata = {
  title: "Users",
  description: "Searchable overview of all users",
};

export default async function AdminUsersPage() {
  const t = await getTranslations("App.Admin.Users");
  const initialPage = await adminUserService.listUsers();

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-2">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-muted-foreground text-sm">{t("description")}</p>
        </div>

        <UserList initialPage={initialPage} />
      </div>
    </div>
  );
}
