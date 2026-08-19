import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";

import { legacyHistoryRange } from "@/components/soko-bot/legacy";
import { LegacyHistory } from "@/components/soko-bot/legacy-history";
import { Panel } from "@/components/soko-bot/panel";
import type { SokoBotLegacyMessage } from "@/lib/clients/generated/core";

interface LegacyHistoryPanelProps {
  messages: readonly SokoBotLegacyMessage[];
  /**
   * Render the full history only when explicitly opened (`?legacy=1`), so the
   * default page and every turn refresh stay small.
   */
  open?: boolean;
}

export const LEGACY_HISTORY_QUERY_KEY = "legacy";

/**
 * Earlier conversations imported from the previous assistant. Kept in its
 * own collapsed panel above the durable turn list so it never reads as part
 * of the current Soko Bot session.
 */
export async function LegacyHistoryPanel({
  messages,
  open = false,
}: LegacyHistoryPanelProps) {
  if (messages.length === 0) return null;
  const [t, format] = await Promise.all([
    getTranslations("App.SokoBot.Legacy"),
    getFormatter(),
  ]);
  const range = legacyHistoryRange(messages);

  return (
    <Panel
      id="soko-bot-legacy"
      title={t("title")}
      description={t("description")}
      aside={
        range ? (
          <span className="text-muted-foreground text-xs tabular-nums">
            {format.dateTimeRange(range.from, range.to, {
              dateStyle: "medium",
            })}
          </span>
        ) : null
      }
      flush
    >
      <div className="px-4 py-2">
        <Link
          href={open ? "?" : `?${LEGACY_HISTORY_QUERY_KEY}=1#soko-bot-legacy`}
          scroll={false}
          className="text-muted-foreground hover:text-foreground text-xs font-medium underline-offset-4 hover:underline"
          aria-expanded={open}
          aria-controls="soko-bot-legacy-list"
        >
          {open ? t("hide") : t("toggle", { count: messages.length })}
        </Link>
      </div>
      {open ? (
        <div id="soko-bot-legacy-list" className="border-t">
          <LegacyHistory messages={messages} />
        </div>
      ) : null}
    </Panel>
  );
}
