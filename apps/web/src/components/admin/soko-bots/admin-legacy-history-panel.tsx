import { getFormatter, getTranslations } from "next-intl/server";

import { legacyHistoryRange } from "@/components/soko-bot/legacy";
import { LegacyHistory } from "@/components/soko-bot/legacy-history";
import { Panel } from "@/components/soko-bot/panel";
import type { SokoBotLegacyMessage } from "@/lib/clients/generated/core";

interface AdminLegacyHistoryPanelProps {
  messages: readonly SokoBotLegacyMessage[];
}

/** Support diagnostics: imported pre-migration conversation, read-only. */
export async function AdminLegacyHistoryPanel({
  messages,
}: AdminLegacyHistoryPanelProps) {
  const [t, format] = await Promise.all([
    getTranslations("App.Admin.SokoBots.Legacy"),
    getFormatter(),
  ]);
  const range = legacyHistoryRange(messages);

  return (
    <Panel
      id="legacy"
      title={t("title")}
      description={t("description")}
      aside={
        <span className="text-muted-foreground text-xs tabular-nums">
          {t("count", { count: messages.length })}
          {range
            ? ` · ${format.dateTimeRange(range.from, range.to, { dateStyle: "short" })}`
            : ""}
        </span>
      }
      flush
    >
      {messages.length === 0 ? (
        <p className="text-muted-foreground px-4 py-6 text-sm">{t("empty")}</p>
      ) : (
        <details className="group">
          <summary className="text-muted-foreground hover:text-foreground cursor-pointer select-none px-4 py-2 text-xs font-medium">
            {t("toggle", { count: messages.length })}
          </summary>
          <div className="max-h-[40rem] overflow-y-auto border-t">
            <LegacyHistory messages={messages} diagnostics />
          </div>
        </details>
      )}
    </Panel>
  );
}
