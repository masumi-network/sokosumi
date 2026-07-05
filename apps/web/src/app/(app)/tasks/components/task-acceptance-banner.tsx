"use client";

import { TaskStatus } from "@sokosumi/utils";
import { Check, CheckCheck, Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { grantCoworkerScopeAction } from "@/lib/actions/coworker-grant/action";
import { setTaskStatusFromDrag } from "@/lib/actions/task/action";

type Decision = "accept" | "always" | "decline";

/**
 * Owner-facing acceptance banner for a coworker-created task parked in
 * awaiting-acceptance:
 * - Accept: this task only (→ READY); the coworker's next task asks again.
 * - Always allow: grants the creator TASK_CREATE (future tasks start
 *   immediately) and accepts this one.
 * - Decline: cancels the task.
 */
export function TaskAcceptanceBanner({
  taskId,
  creatorId,
  creatorName,
  assigneeName,
}: {
  taskId: string;
  creatorId: string | null;
  creatorName: string;
  assigneeName: string | null;
}) {
  const t = useTranslations("App.Tasks.acceptance");
  const router = useRouter();
  const [busy, setBusy] = useState<Decision | null>(null);

  const resolve = async (decision: Decision) => {
    if (busy) return;
    setBusy(decision);
    try {
      if (decision === "always" && creatorId) {
        const granted = await grantCoworkerScopeAction(
          creatorId,
          "TASK_CREATE",
        );
        if (!granted.ok) {
          toast.error(granted.error.message ?? t("resolveFailed"));
          return;
        }
      }
      await setTaskStatusFromDrag({
        taskId,
        desiredStatus:
          decision === "decline" ? TaskStatus.CANCELED : TaskStatus.READY,
      });
      toast.success(
        decision === "decline"
          ? t("declinedToast")
          : decision === "always"
            ? t("alwaysToast", { creatorName })
            : t("acceptedToast"),
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
      <div className="flex flex-wrap items-center gap-1.5">
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
            {creatorId ? (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => void resolve("always")}
              >
                <CheckCheck className="size-3.5" aria-hidden />
                <span>{t("acceptAlways", { creatorName })}</span>
              </Button>
            ) : null}
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
