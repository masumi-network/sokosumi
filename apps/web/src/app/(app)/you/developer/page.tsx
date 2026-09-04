import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { MobileStackedMenuSkeleton } from "@/app/components/mobile-stacked-menu/mobile-stacked-menu-skeleton";
import { getDeveloperVendorAdminAccess } from "@/app/developer/get-developer-vendor-admin-access";
import { YouDeveloperStackClient } from "@/app/you/components/you-submenu-stack.client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Components.UserAvatar");

  return {
    title: t("developer"),
  };
}

async function YouDeveloperContent() {
  const { showVendors: showDeveloperVendors } =
    await getDeveloperVendorAdminAccess();

  return (
    <YouDeveloperStackClient showDeveloperVendors={showDeveloperVendors} />
  );
}

export default async function YouDeveloperPage() {
  await connection();

  return (
    <Suspense fallback={<MobileStackedMenuSkeleton />}>
      <YouDeveloperContent />
    </Suspense>
  );
}
