import { Metadata } from "next";
import { useTranslations } from "next-intl";

export const metadata: Metadata = {
  title: "Billing",
  description: "Manage your billing settings and preferences",
};

export default function BillingPage() {
  const t = useTranslations("App.Billing");
  return <div>{t("title")}</div>;
}
