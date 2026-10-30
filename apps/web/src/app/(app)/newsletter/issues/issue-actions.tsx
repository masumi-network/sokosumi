"use client";

import type { NewsletterIssue } from "@sokosumi/core-client";
import { CalendarClock, Check, Send } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { SocialPostSchedulePicker } from "@/app/projects/components/social-posts/social-post-schedule-picker";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { changeNewsletterIssue } from "@/lib/actions/newsletter/issue-lifecycle";

type IssueAction = "submit" | "approve" | "schedule" | "sendNow" | "cancel";
interface IssueActionsProps {
  issue: NewsletterIssue;
  projectId: string;
  activeSubscribers: number;
  disabled?: boolean;
  onChanged?: (issue: NewsletterIssue) => void;
  onBusyChange?: (busy: boolean) => void;
}

/** Shared by the list and editor so both expose the same approval flow. */
export function IssueActions({
  issue,
  projectId,
  activeSubscribers,
  disabled,
  onChanged,
  onBusyChange,
}: IssueActionsProps) {
  const t = useTranslations("App.Projects.Newsletter.Issues.Lifecycle");
  const format = useFormatter();
  const router = useRouter();
  const [pending, setPending] = useState<IssueAction | null>(null);
  const [dialog, setDialog] = useState<
    "schedule" | "sendNow" | "cancel" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [scheduledAt, setScheduledAt] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [earliest, setEarliest] = useState<Date | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const actionContainer = useRef<HTMLDivElement>(null);
  function handleCloseAutoFocus(event: Event) {
    const target = opener.current?.isConnected
      ? opener.current
      : actionContainer.current?.querySelector<HTMLElement>(
          "button:not([disabled]), a",
        );
    if (target) {
      event.preventDefault();
      target.focus();
    }
  }
  const whenId = useId();
  const errorId = useId();
  const approved = Boolean(issue.approvedAt && issue.approvedByUserId);

  async function handleChange(action: IssueAction) {
    setError(null);
    let instant: string | undefined;
    if (action === "schedule") {
      const date = new Date(scheduledAt);
      if (
        Number.isNaN(date.getTime()) ||
        date.getTime() < Date.now() + 60_000 ||
        date.getTime() > Date.now() + 365 * 24 * 60 * 60_000
      ) {
        setError(t("invalidSchedule"));
        return;
      }
      instant = date.toISOString();
    }
    setPending(action);
    onBusyChange?.(true);
    try {
      const result = await changeNewsletterIssue({
        projectId,
        issueId: issue.id,
        revision: issue.revision,
        action,
        ...(action === "schedule" ? { scheduledAt: instant, timezone } : {}),
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      onChanged?.(result.value);
      setDialog(null);
      router.refresh();
    } catch {
      setError(t("error"));
    } finally {
      setPending(null);
      onBusyChange?.(false);
    }
  }

  function handleDialog(
    next: "schedule" | "sendNow" | "cancel",
    trigger: HTMLButtonElement,
  ) {
    opener.current = trigger;
    setError(null);
    if (next === "schedule") {
      setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
      setEarliest(new Date(Date.now() + 60_000));
      setScheduledAt("");
    }
    setDialog(next);
  }

  const locked = disabled || pending !== null;
  const confirmation =
    dialog === "sendNow" || dialog === "cancel" ? dialog : null;
  return (
    <div ref={actionContainer} className="min-w-0 space-y-2">
      {issue.approvedAt && issue.approvedByUserId ? (
        <p className="text-muted-foreground text-sm">
          {t("approvedBy", {
            user: issue.approvedByName ?? t("formerMember"),
            date: format.dateTime(issue.approvedAt, "dateTime"),
          })}
        </p>
      ) : null}
      {issue.scheduledAt && ["SCHEDULED", "SENDING"].includes(issue.status) ? (
        <p className="text-muted-foreground text-sm">
          {t("scheduled", {
            date: format.dateTime(issue.scheduledAt, "dateTime", {
              timeZone: issue.timezone ?? "UTC",
            }),
            timezone: issue.timezone ?? "UTC",
          })}
        </p>
      ) : null}
      {issue.taskId ? (
        <Link
          className="text-sm underline underline-offset-4"
          href={`/tasks/${issue.taskId}`}
        >
          {t("task")}
        </Link>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {issue.status === "DRAFT" ? (
          <Button
            variant="outline"
            disabled={locked}
            loading={pending === "submit"}
            onClick={() => void handleChange("submit")}
          >
            <Send />
            {t("submit")}
          </Button>
        ) : null}
        {issue.status === "NEEDS_APPROVAL" && !approved ? (
          <Button
            variant="outline"
            disabled={locked}
            loading={pending === "approve"}
            onClick={() => void handleChange("approve")}
          >
            <Check />
            {t("approve")}
          </Button>
        ) : null}
        {issue.status === "NEEDS_APPROVAL" && approved ? (
          <>
            <Button
              variant="outline"
              disabled={locked}
              onClick={(event) => handleDialog("schedule", event.currentTarget)}
            >
              <CalendarClock />
              {t("schedule")}
            </Button>
            <Button
              variant="outline"
              disabled={locked}
              onClick={(event) => handleDialog("sendNow", event.currentTarget)}
            >
              <Send />
              {t("sendNow")}
            </Button>
          </>
        ) : null}
        {issue.status === "SCHEDULED" ? (
          <Button
            variant="outline"
            disabled={locked}
            onClick={(event) => handleDialog("cancel", event.currentTarget)}
          >
            {t("cancel")}
          </Button>
        ) : null}
      </div>
      {error && !dialog ? (
        <p role="alert" className="text-foreground text-sm">
          {error}
        </p>
      ) : null}
      <Dialog
        open={dialog === "schedule"}
        onOpenChange={(open) => {
          if (!open && !pending) setDialog(null);
        }}
      >
        <DialogContent onCloseAutoFocus={handleCloseAutoFocus}>
          <DialogHeader>
            <DialogTitle>{t("scheduleTitle")}</DialogTitle>
            <DialogDescription>{t("scheduleDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label id={whenId}>{t("when")}</Label>
            {earliest ? (
              <SocialPostSchedulePicker
                earliest={earliest}
                labelledBy={whenId}
                describedBy={error ? errorId : undefined}
                invalid={Boolean(error)}
                disabled={Boolean(pending)}
                value={scheduledAt}
                onChange={setScheduledAt}
              />
            ) : null}
            <p className="text-muted-foreground text-sm">
              {t("timezone", { timezone })}
            </p>
            {error ? (
              <p id={errorId} role="alert" className="text-foreground text-sm">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={Boolean(pending)}
              onClick={() => setDialog(null)}
            >
              {t("close")}
            </Button>
            <Button
              variant="primary"
              loading={pending === "schedule"}
              onClick={() => void handleChange("schedule")}
            >
              {t("schedule")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setDialog(null);
        }}
      >
        <AlertDialogContent onCloseAutoFocus={handleCloseAutoFocus}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(confirmation === "sendNow" ? "sendTitle" : "cancelTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmation === "sendNow"
                ? t("sendDescription", { count: activeSubscribers })
                : t("cancelDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error ? (
            <p role="alert" className="text-foreground text-sm">
              {error}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(pending)}>
              {t("close")}
            </AlertDialogCancel>
            <AlertDialogAction
              loading={pending !== null}
              onClick={(event) => {
                event.preventDefault();
                if (confirmation) void handleChange(confirmation);
              }}
            >
              {t(confirmation === "sendNow" ? "sendNow" : "cancel")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
