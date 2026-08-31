import { getFormatter, getTranslations } from "next-intl/server";

import { shortId } from "@/components/soko-bot/format";
import { Panel } from "@/components/soko-bot/panel";
import type { AdminSokoBotDetail } from "@/lib/clients/generated/core";
import { formatBytes } from "@/lib/utils/format-bytes";

interface AdminMemoryPanelProps {
  bot: AdminSokoBotDetail;
}

/**
 * Memory revisions (metadata table) plus the current markdown behind a
 * disclosure. Memory is user working notes, never provider reasoning.
 */
export async function AdminMemoryPanel({ bot }: AdminMemoryPanelProps) {
  const [t, format] = await Promise.all([
    getTranslations("App.Admin.SokoBots.Memory"),
    getFormatter(),
  ]);
  const revisions = bot.memoryRevisions.filter(
    (revision): revision is NonNullable<typeof revision> => revision !== null,
  );
  const current = revisions[0] ?? null;
  const encoder = new TextEncoder();

  return (
    <Panel
      id="memory"
      title={t("title")}
      description={t("description")}
      aside={
        <span className="text-muted-foreground text-xs tabular-nums">
          {t("currentVersion", { version: bot.memoryVersion })}
        </span>
      }
      flush
    >
      {revisions.length === 0 ? (
        <p className="text-muted-foreground px-4 py-6 text-sm">{t("empty")}</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground border-b text-left text-xs">
                <tr>
                  <th className="px-4 py-2 font-medium">{t("version")}</th>
                  <th className="px-4 py-2 font-medium">{t("hash")}</th>
                  <th className="px-4 py-2 font-medium">{t("size")}</th>
                  <th className="px-4 py-2 font-medium">{t("source")}</th>
                  <th className="px-4 py-2 font-medium">{t("createdAt")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {revisions.map((revision) => (
                  <tr key={revision.id}>
                    <td className="px-4 py-2 tabular-nums">
                      {revision.version}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {shortId(revision.hash)}
                    </td>
                    <td className="px-4 py-2 tabular-nums">
                      {formatBytes(encoder.encode(revision.markdown).length)}
                    </td>
                    <td className="px-4 py-2 text-xs">{revision.source}</td>
                    <td className="text-muted-foreground px-4 py-2 text-xs tabular-nums">
                      {format.dateTime(revision.createdAt, {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {current ? (
            <details className="border-t">
              <summary className="text-muted-foreground hover:text-foreground cursor-pointer select-none px-4 py-2 text-xs font-medium">
                {t("showCurrent")}
              </summary>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap border-t px-4 py-3 font-mono text-xs">
                {current.markdown}
              </pre>
            </details>
          ) : null}
        </>
      )}
    </Panel>
  );
}
