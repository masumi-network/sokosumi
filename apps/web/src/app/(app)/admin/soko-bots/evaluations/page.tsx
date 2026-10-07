import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import {
  JudgeEvaluations,
  RouterEvaluations,
} from "@/components/admin/soko-bots/model-evaluations";
import { adminSokoBotService } from "@/lib/services/admin-soko-bot.service";

export const instant = false;

export const metadata: Metadata = {
  title: "Model evaluations",
  description: "How candidate models compare for the Soko Bot judge and router",
};

export default async function AdminSokoBotEvaluationsPage() {
  const [t, evaluations] = await Promise.all([
    getTranslations("App.Admin.SokoBots.Evaluations"),
    adminSokoBotService.evaluations(),
  ]);
  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-2">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-muted-foreground text-sm">{t("description")}</p>
        </div>
        <JudgeEvaluations
          runs={evaluations.judge}
          currentModel={evaluations.currentJudgeModel}
        />
        <RouterEvaluations
          runs={evaluations.router}
          currentModel={evaluations.currentRouteModel}
        />
      </div>
    </div>
  );
}
