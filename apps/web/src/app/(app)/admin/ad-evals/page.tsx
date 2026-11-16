import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AdEvalsDashboard } from "@/components/admin/ad-evals/ad-evals-dashboard";
import { CoreApiRequestError } from "@/lib/clients/core.request";
import { adminAdEvalsService } from "@/lib/services/admin-ad-evals.service";

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Admin.AdEvals");
  return { title: t("title") };
}

export default async function AdminAdEvalsPage() {
  if (!(await adminAdEvalsService.hasAccess())) {
    notFound();
  }

  const data = await adminAdEvalsService
    .getDashboard()
    .catch((error: unknown) => {
      if (error instanceof CoreApiRequestError && error.status === 403) {
        notFound();
      }
      throw error;
    });
  return <AdEvalsDashboard data={data} />;
}
