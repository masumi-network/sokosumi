import { Coins } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { PropertyRow } from "@/app/tasks/components/task-metadata";
import { historyService } from "@/lib/services/history.service";

/**
 * Credits row in a Task's properties: the net credits its charges and its
 * Jobs took, minus refunds, opening that slice of Transactions. No row when
 * the ledger cannot be read (no seat, Core down): unknown is not zero.
 */
export async function TaskCreditsUsed({ taskId }: { taskId: string }) {
  const [total, t] = await Promise.all([
    historyService.getTaskTotal(taskId).catch(() => null),
    getTranslations("App.Tasks.Detail"),
  ]);

  if (!total) {
    return null;
  }

  const value =
    total.count === 0
      ? t("noCreditsUsed")
      : t("creditsUsed", { credits: total.credits });
  const params = new URLSearchParams({ taskId, scope: "workspace" });

  return (
    <PropertyRow
      label={t("credits")}
      value={value}
      icon={<Coins className="text-muted-foreground size-4" />}
    >
      {total.count === 0 ? (
        <span className="text-muted-foreground truncate">{value}</span>
      ) : (
        <Link
          href={`/history?${params.toString()}`}
          className="hover:text-foreground truncate font-medium transition-colors"
        >
          {value}
        </Link>
      )}
    </PropertyRow>
  );
}
