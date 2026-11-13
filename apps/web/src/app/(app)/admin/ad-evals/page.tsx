import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AdEvalsDashboard } from "@/components/admin/ad-evals/ad-evals-dashboard";
import { adminAdEvalsService } from "@/lib/services/admin-ad-evals.service";

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Admin.AdEvals");
  return { title: t("title") };
}

export default async function AdminAdEvalsPage() {
  const data = await adminAdEvalsService.getDashboard();
  return <AdEvalsDashboard data={data} />;
}
