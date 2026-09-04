import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { MobileStackedMenuSkeleton } from "@/app/components/mobile-stacked-menu/mobile-stacked-menu-skeleton";
import { YouSubmenuStackClient } from "@/app/you/components/you-submenu-stack.client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Components.UserAvatar");

  return {
    title: t("help"),
  };
}

export default async function YouHelpPage() {
  await connection();

  return (
    <Suspense fallback={<MobileStackedMenuSkeleton />}>
      <YouSubmenuStackClient kind="help" />
    </Suspense>
  );
}
