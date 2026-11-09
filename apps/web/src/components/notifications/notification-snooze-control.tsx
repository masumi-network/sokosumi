"use client";

import type { NotificationItem } from "@sokosumi/core-client";
import { AlarmClock, AlarmClockOff } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNotifications } from "@/contexts/notification-provider";
import { SNOOZE_PRESETS, snoozeUntil } from "@/lib/utils/notification-snooze";

const CONTROL_CLASS_NAME =
  "text-muted-foreground size-10 md:size-8 shrink-0 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/row:opacity-100 [@media(hover:hover)]:group-focus-within/row:opacity-100 data-[state=open]:opacity-100";

interface NotificationSnoozeControlProps {
  notification: NotificationItem;
  /** The row's own message, so a column of controls says what each acts on. */
  notificationMessage: string;
}

/**
 * Snooze beside the read toggle: the row leaves until the chosen time, then
 * is back unread. In the Snoozed view it is the way back out. Chat rows have
 * none, because their room counts them.
 */
export function NotificationSnoozeControl({
  notification,
  notificationMessage,
}: NotificationSnoozeControlProps) {
  const t = useTranslations("Components.NotificationCenter");
  const format = useFormatter();
  const { view, snooze } = useNotifications();

  if (notification.kind === "CHAT") return null;

  function apply(until: Date | null): void {
    snooze(notification.id, until)
      .then(() => {
        if (until === null) {
          toast.success(t("unsnoozed"));
          return;
        }
        toast.success(
          t("snoozedToast", { when: format.dateTime(until, "dateTime") }),
          {
            // Unsnooze, not Undo: the row stays unread, as snoozing made it.
            action: {
              label: t("unsnoozeTooltip"),
              onClick: () => apply(null),
            },
          },
        );
      })
      .catch(() => {
        toast.error(until === null ? t("unsnoozeError") : t("snoozeError"));
      });
  }

  if (view === "snoozed") {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t("unsnooze", { message: notificationMessage })}
        title={t("unsnoozeTooltip")}
        className={CONTROL_CLASS_NAME}
        onClick={() => apply(null)}
      >
        <AlarmClockOff className="size-4" />
      </Button>
    );
  }

  const now = new Date();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("snooze", { message: notificationMessage })}
          title={t("snoozeTooltip")}
          className={CONTROL_CLASS_NAME}
        >
          <AlarmClock className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("snoozeMenuLabel")}</DropdownMenuLabel>
        {SNOOZE_PRESETS.map((preset) => {
          const until = snoozeUntil(preset, now);
          return (
            <DropdownMenuItem key={preset} onSelect={() => apply(until)}>
              {t(`snoozePreset.${preset}`)}
              <DropdownMenuShortcut>
                {format.dateTime(until, "dateTime")}
              </DropdownMenuShortcut>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
