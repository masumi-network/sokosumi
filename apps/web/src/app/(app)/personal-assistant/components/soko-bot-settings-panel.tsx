import { getTranslations } from "next-intl/server";

import { Panel } from "@/components/soko-bot/panel";
import type { SokoBot } from "@/lib/clients/generated/core";

import { ArchiveSokoBotButton } from "./archive-soko-bot-button.client";
import { AutonomySettings } from "./autonomy-settings.client";

interface SokoBotSettingsPanelProps {
  bot: SokoBot;
}

export async function SokoBotSettingsPanel({ bot }: SokoBotSettingsPanelProps) {
  const t = await getTranslations("App.SokoBot.Settings");
  return (
    <Panel id="soko-bot-settings" title={t("title")}>
      <div className="space-y-4">
        <AutonomySettings current={bot.autonomyLevel} />
        <div className="space-y-2 border-t pt-4">
          <p className="text-sm font-medium">{t("archiveTitle")}</p>
          <p className="text-muted-foreground text-xs">
            {t("archiveDescription")}
          </p>
          <ArchiveSokoBotButton />
        </div>
      </div>
    </Panel>
  );
}
