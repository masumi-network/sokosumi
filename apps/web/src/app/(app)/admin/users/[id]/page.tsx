import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { UserSignUpSection } from "@/components/admin/users/user-sign-up-section";
import { Button } from "@/components/ui/button";
import { coreClient } from "@/lib/clients/core.client";

export const instant = false;

export const metadata: Metadata = {
  title: "User",
  description: "Admin user overview",
};

interface AdminUserDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminUserDetailPage({
  params,
}: AdminUserDetailPageProps) {
  const { id } = await params;
  const userId = decodeURIComponent(id);
  const [t, user, signUp] = await Promise.all([
    getTranslations("App.Admin.Users.UserDetail"),
    coreClient.getUserById(userId),
    coreClient.getUserSignUp(userId),
  ]);

  if (!user) {
    notFound();
  }

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight wrap-break-word">
              {user.name}
            </h1>
            <p className="text-muted-foreground text-sm wrap-anywhere">
              {user.email}
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin/users">{t("backToList")}</Link>
          </Button>
        </div>

        <UserSignUpSection signUp={signUp} />
      </div>
    </div>
  );
}
