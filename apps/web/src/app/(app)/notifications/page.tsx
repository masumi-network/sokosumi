import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getSessionOrRedirect } from "@/lib/auth/auth.server";

import { NotificationsPageContent } from "./page-content";

/** The browser tab names the page, not the product's tagline. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Components.NotificationCenter");

  return {
    title: t("pageTitle"),
    description: t("pageDescription"),
  };
}

export default async function NotificationsPage() {
  await getSessionOrRedirect();

  return <NotificationsPageContent />;
}
