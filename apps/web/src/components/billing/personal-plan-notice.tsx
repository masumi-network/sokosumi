"use client";

import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { useWorkspaceSwitcher } from "@/app/components/user-avatar/workspace-switcher";
import { Button } from "@/components/ui/button";

interface PersonalPlanNoticeProps {
  canSwitchToPersonal: boolean;
  planName: string;
  scheduledCancelDate: Date | null;
}

export function PersonalPlanNotice({
  canSwitchToPersonal,
  planName,
  scheduledCancelDate,
}: PersonalPlanNoticeProps) {
  const t = useTranslations("App.Subscriptions");
  const formatter = useFormatter();
  const { handleSelectWorkspace, isPending } = useWorkspaceSwitcher();

  const message = scheduledCancelDate
    ? t("personalPlanNoticeCancels", {
        date: formatter.dateTime(scheduledCancelDate, {
          day: "numeric",
          month: "short",
          year: "numeric",
        }),
        plan: planName,
      })
    : t("personalPlanNotice", { plan: planName });

  return (
    <div className="bg-card text-muted-foreground flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-3 text-sm">
      <span>{message}</span>
      {canSwitchToPersonal ? (
        <Button
          className="relative h-auto p-0 after:absolute after:-inset-2"
          disabled={isPending}
          onClick={() => {
            handleSelectWorkspace(null).catch(() => {
              toast.error(t("switchToPersonalWorkspaceError"));
            });
          }}
          size="sm"
          variant="link"
        >
          {t("switchToPersonalWorkspace")}
        </Button>
      ) : null}
    </div>
  );
}
