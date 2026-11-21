import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { historyService } from "@/lib/services/history.service";

/**
 * Credits line under the Organization row in a Task's properties: the net
 * credits its charges and its Jobs took, minus refunds, opening that slice of
 * Transactions. No line when the ledger cannot be read (no seat, Core down):
 * unknown is not zero.
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
      : // Cut to cents as Transactions does, so both pages show one number.
        t("creditsUsed", { credits: Math.trunc(total.credits * 100) / 100 });
  const params = new URLSearchParams({ taskId, scope: "workspace" });

  // A sub-line of the Organization row: indented to its name, a size down.
  // Truncate the child, not the line, so the line never clips the focus ring.
  const fit = "inline-block max-w-full truncate align-top";
  return (
    <p className="text-muted-foreground -mt-1 pb-1 pl-7 text-xs">
      {total.count === 0 ? (
        <span className={fit}>{value}</span>
      ) : (
        <Link
          href={`/history?${params.toString()}`}
          className={`${fit} hover:text-foreground rounded-sm underline-offset-2 transition-colors hover:underline`}
        >
          {value}
        </Link>
      )}
    </p>
  );
}
