import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { WritingSkillsView } from "@/components/admin/writing-skills/writing-skills-view";
import { adminSokoBotService } from "@/lib/services/admin-soko-bot.service";

export const instant = false;

export const metadata: Metadata = {
  title: "Writing skills",
  description: "How Cuso writes for each network",
};

export default async function AdminWritingSkillsPage({
  searchParams,
}: {
  searchParams: Promise<{ skill?: string }>;
}) {
  const [t, { groups }, { skill }] = await Promise.all([
    getTranslations("App.Admin.WritingSkills"),
    adminSokoBotService.writingSkills(),
    searchParams,
  ]);
  return (
    <div className="min-h-full w-full space-y-6 px-4 py-2">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </div>
      <WritingSkillsView groups={groups} selectedId={skill} />
    </div>
  );
}
