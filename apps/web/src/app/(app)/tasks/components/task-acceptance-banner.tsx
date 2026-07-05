"use client";

import { TaskStatus } from "@sokosumi/utils";
import { Check, Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { setTaskStatusFromDrag } from "@/lib/actions/task/action";

/**
 * Owner-facing acceptance banner for a coworker-created task that is held
 * in DRAFT: accepting flips it to READY (the assigned coworker can then
 * pick it up), declining cancels it. Rendered only while
 * `task.awaitingAcceptance` is set.
 */
export function TaskAcceptanceBanner({
  taskId,
  creatorName,
  assigneeName,
}: {
  taskId: string;
  creatorName: string;
  assigneeName: string | null;
}) {
  const t = useTranslations("App.Tasks.acceptance");
  const router = useRouter();
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);

  const resolve = async (decision: "accept" | "decline") => {
    if (busy) return;
    setBusy(decision);
    try {
      await setTaskStatusFromDrag({
        taskId,
        desiredStatus:
          decision === "accept" ? TaskStatus.READY : TaskStatus.CANCELED,
      });
      toast.success(
        decision === "accept" ? t("acceptedToast") : t("declinedToast"),
      );
      router.refresh();
    } catch {
      toast.error(t("resolveFailed"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="border-semantic-warning/30 bg-semantic-warning/5 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-foreground text-sm font-medium">
          {t("bannerTitle", { creatorName })}
        </p>
        <p className="text-muted-foreground mt-0.5 text-sm">
          {assigneeName
            ? t("bannerBody", { assigneeName })
            : t("bannerBodyUnassigned")}
        </p>
      </div>
      <div className="flex items-center gap-1.5">
        {busy ? (
          <Loader2
            className="text-muted-foreground size-4 animate-spin"
            aria-hidden
          />
        ) : (
          <>
            <Button
              size="sm"
              variant="primary"
              className="gap-1.5"
              onClick={() => void resolve("accept")}
            >
              <Check className="size-3.5" aria-hidden />
              <span>{t("accept")}</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => void resolve("decline")}
            >
              <X className="size-3.5" aria-hidden />
              <span>{t("decline")}</span>
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
