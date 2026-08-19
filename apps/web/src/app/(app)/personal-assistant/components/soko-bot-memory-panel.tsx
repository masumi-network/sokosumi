import { getFormatter, getTranslations } from "next-intl/server";

import { shortId } from "@/components/soko-bot/format";
import { MetaGrid } from "@/components/soko-bot/meta-grid";
import { Panel } from "@/components/soko-bot/panel";
import type { SokoBot } from "@/lib/clients/generated/core";
import { formatBytes } from "@/lib/utils/format-bytes";

import { ResetMemoryButton } from "./reset-memory-button.client";

interface SokoBotMemoryPanelProps {
  bot: SokoBot;
}

/** Short-term working notes: metadata + the markdown itself, plus reset. */
export async function SokoBotMemoryPanel({ bot }: SokoBotMemoryPanelProps) {
  const [t, format] = await Promise.all([
    getTranslations("App.SokoBot.Memory"),
    getFormatter(),
  ]);
  const memory = bot.memory ?? null;
  const size = memory ? new TextEncoder().encode(memory.markdown).length : 0;

  return (
    <Panel
      id="soko-bot-memory"
      title={t("title")}
      description={t("description")}
      aside={<ResetMemoryButton />}
    >
      <div className="space-y-3">
        <MetaGrid
          columns={2}
          items={[
            { label: t("version"), value: bot.memoryVersion },
            { label: t("hash"), value: shortId(bot.memoryHash), mono: true },
            { label: t("size"), value: memory ? formatBytes(size) : null },
            {
              label: t("updated"),
              value: memory
                ? format.dateTime(memory.createdAt, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })
                : null,
            },
          ]}
        />
        {memory ? (
          <details className="rounded border">
            <summary className="text-muted-foreground hover:text-foreground cursor-pointer select-none px-3 py-1.5 text-xs font-medium">
              {t("show")}
            </summary>
            <pre className="text-foreground max-h-72 overflow-auto whitespace-pre-wrap border-t px-3 py-2 font-mono text-xs">
              {memory.markdown}
            </pre>
          </details>
        ) : (
          <p className="text-muted-foreground text-xs">{t("empty")}</p>
        )}
      </div>
    </Panel>
  );
}
