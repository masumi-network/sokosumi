"use client";

import type {
  NewsletterIssue,
  NewsletterSendingDomainState,
} from "@sokosumi/core-client";
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
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { Label } from "@/components/ui/label";
import {
  MARKER_ICONS,
  StatusMarker,
  type StatusMarkerSpec,
} from "@/components/ui/status-marker";
import { changeNewsletterIssue } from "@/lib/actions/newsletter/issue-lifecycle";
import { cn } from "@/lib/utils";
import {
  IssueDeliveryOutcome,
  IssueStatusBadge,
} from "./issue-delivery-status";
import { getIssueStage, getStepIndex } from "./issue-flow";
import { hasNewsletterSender, IssueReadiness } from "./issue-readiness";
import { IssueSteps } from "./issue-steps";

const BLOCKER: StatusMarkerSpec = {
  tone: { hue: "blocked", weight: "filled" },
  icon: MARKER_ICONS.warning,
};

type IssueAction = "submit" | "approve" | "schedule" | "sendNow" | "cancel";
interface IssueActionsProps {
  issue: NewsletterIssue;
  projectId: string;
  activeSubscribers: number;
  senderName: string;
  sendingDomain: NewsletterSendingDomainState;
  disabled?: boolean;
  /** The editor has changes that are not saved yet. */
  unsaved?: boolean;
  onChanged?: (issue: NewsletterIssue) => void;
  onBusyChange?: (busy: boolean) => void;
}

/** The list opens this editor flow for review before approval, scheduling, or sending, keeping the same human confirmation steps. The panel names the current step, says what still blocks it, and puts that step's one action next to the reason. */
export function IssueActions({
  issue,
  projectId,
  activeSubscribers,
  senderName,
  sendingDomain,
  disabled,
  unsaved = false,
  onChanged,
  onBusyChange,
}: IssueActionsProps) {
  const t = useTranslations("App.Projects.Newsletter.Issues.Lifecycle");
  const flow = useTranslations("App.Projects.Newsletter.Issues.Flow");
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
  const headingId = useId();
  const blockersId = useId();
  const approved = Boolean(issue.approvedAt && issue.approvedByUserId);

  async function handleChange(action: IssueAction) {
    setError(null);
    if (action === "sendNow" || action === "schedule") {
      if (activeSubscribers === 0) {
        setError(t("noSubscribers"));
        return;
      }
      if (!hasNewsletterSender(sendingDomain)) {
        setError(t("noSender"));
        return;
      }
    }
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
  const deliveryBlocked =
    locked || activeSubscribers === 0 || !hasNewsletterSender(sendingDomain);
  const confirmation =
    dialog === "sendNow" || dialog === "cancel" ? dialog : null;
  const stage = getIssueStage(issue, unsaved);
  const actionable = ["DRAFT", "NEEDS_APPROVAL", "SCHEDULED"].includes(
    issue.status,
  );
  const hint = `hints.${stage}` as const;
  // The reasons an action is off, said beside it rather than further up.
  const blockers = [
    unsaved && t("saveFirst"),
    stage === "send" && activeSubscribers === 0 && flow("noSubscribers"),
    stage === "send" && !hasNewsletterSender(sendingDomain) && flow("noSender"),
  ].filter((blocker) => typeof blocker === "string");
  const describedBy = blockers.length ? blockersId : undefined;
  const taskLink = issue.taskId ? (
    <Link
      className="text-sm underline underline-offset-4"
      href={`/tasks/${issue.taskId}`}
    >
      {t("task")}
    </Link>
  ) : null;
  return (
    <section
      ref={actionContainer}
      aria-labelledby={headingId}
      className={cn(HOLDER_CLASS, "min-w-0 space-y-2")}
    >
      {getStepIndex(stage) >= 0 ? (
        <IssueSteps current={getStepIndex(stage)} failed={stage === "failed"} />
      ) : null}
      <div className={cn(HOLDER_ITEM_CLASS, "min-w-0 space-y-4 p-4")}>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 space-y-1">
            <h2 id={headingId} className="text-lg font-semibold">
              {flow(`titles.${stage}`)}
            </h2>
            {flow.has(hint) ? (
              <p className="text-muted-foreground text-sm">{flow(hint)}</p>
            ) : null}
          </div>
          <IssueStatusBadge issue={issue} />
        </div>
        {/* Under Approve the task is a button beside Approve instead. */}
        {approved || (taskLink && stage !== "approve") ? (
          <p className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-sm">
            {issue.approvedAt && approved ? (
              <span>
                {t("approvedBy", {
                  user: issue.approvedByName ?? t("formerMember"),
                  date: format.dateTime(issue.approvedAt, "dateTime"),
                })}
              </span>
            ) : null}
            {taskLink}
          </p>
        ) : null}
        {issue.scheduledAt && issue.status === "SENDING" ? (
          <p className="text-muted-foreground text-sm">
            {t("scheduled", {
              date: format.dateTime(issue.scheduledAt, "dateTime", {
                timeZone: issue.timezone ?? "UTC",
              }),
              timezone: issue.timezone ?? "UTC",
            })}
          </p>
        ) : null}
        <IssueDeliveryOutcome issue={issue} projectId={projectId} />
        {actionable ? (
          <IssueReadiness
            issue={issue}
            projectId={projectId}
            activeSubscribers={activeSubscribers}
            senderName={senderName}
            sendingDomain={sendingDomain}
            linksDisabled={Boolean(locked)}
            framed={false}
          />
        ) : null}
        {actionable ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t pt-4">
            <div className="flex flex-wrap gap-2">
              {issue.status === "DRAFT" ? (
                <Button
                  variant={stage === "review" ? "primary" : "outline"}
                  aria-describedby={describedBy}
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
                  variant="primary"
                  aria-describedby={describedBy}
                  disabled={locked}
                  loading={pending === "approve"}
                  onClick={() => void handleChange("approve")}
                >
                  <Check />
                  {t("approve")}
                </Button>
              ) : null}
              {stage === "approve" && taskLink ? (
                <Button asChild variant="outline">
                  {taskLink}
                </Button>
              ) : null}
              {issue.status === "NEEDS_APPROVAL" && approved ? (
                <>
                  <Button
                    variant="primary"
                    aria-describedby={describedBy}
                    disabled={deliveryBlocked}
                    onClick={(event) =>
                      handleDialog("schedule", event.currentTarget)
                    }
                  >
                    <CalendarClock />
                    {t("schedule")}
                  </Button>
                  <Button
                    variant="outline"
                    aria-describedby={describedBy}
                    disabled={deliveryBlocked}
                    onClick={(event) =>
                      handleDialog("sendNow", event.currentTarget)
                    }
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
                  onClick={(event) =>
                    handleDialog("cancel", event.currentTarget)
                  }
                >
                  {t("cancel")}
                </Button>
              ) : null}
            </div>
            {blockers.length ? (
              <ul
                id={blockersId}
                className="min-w-0 flex-1 basis-60 space-y-1 text-sm"
              >
                {blockers.map((blocker) => (
                  <li key={blocker} className="flex items-start gap-2">
                    <span className="flex h-5 items-center">
                      <StatusMarker spec={BLOCKER} />
                    </span>
                    {blocker}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {error && !dialog ? (
          <p role="alert" className="text-foreground text-sm">
            {error}
          </p>
        ) : null}
      </div>
      <Dialog
        open={dialog === "schedule"}
        onOpenChange={(open) => {
          if (!open && !pending) setDialog(null);
        }}
      >
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain"
          onCloseAutoFocus={handleCloseAutoFocus}
        >
          <DialogHeader>
            <DialogTitle>{t("scheduleTitle")}</DialogTitle>
            <DialogDescription>{t("scheduleDescription")}</DialogDescription>
          </DialogHeader>
          <IssueReadiness
            issue={issue}
            projectId={projectId}
            activeSubscribers={activeSubscribers}
            senderName={senderName}
            sendingDomain={sendingDomain}
            timing="schedule"
            linksDisabled={Boolean(locked)}
          />
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
              disabled={deliveryBlocked}
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
        <AlertDialogContent
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain"
          onCloseAutoFocus={handleCloseAutoFocus}
        >
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
          {confirmation === "sendNow" ? (
            <IssueReadiness
              issue={issue}
              projectId={projectId}
              activeSubscribers={activeSubscribers}
              senderName={senderName}
              sendingDomain={sendingDomain}
              timing="sendNow"
              linksDisabled={Boolean(locked)}
            />
          ) : null}
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
              disabled={confirmation === "sendNow" && Boolean(deliveryBlocked)}
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
    </section>
  );
}
