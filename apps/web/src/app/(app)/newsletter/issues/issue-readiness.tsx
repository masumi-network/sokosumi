import type {
  NewsletterIssue,
  NewsletterSendingDomainState,
} from "@sokosumi/core-client";
import { Check, Circle, CircleAlert } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { newsletterHref } from "@/app/newsletter/newsletter-tabs";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";

export function hasNewsletterSender(state: NewsletterSendingDomainState) {
  return state.sendingDomain?.status === "VERIFIED" || state.fallbackAvailable;
}

type CheckState = "done" | "blocked" | "pending";

/** The prerequisites for scheduling or sending, as a checklist whose blocked rows stand out and link to their fix. */
export function IssueReadiness({
  issue,
  projectId,
  activeSubscribers,
  senderName,
  sendingDomain,
  timing,
  linksDisabled = false,
}: {
  issue: NewsletterIssue;
  projectId: string;
  activeSubscribers: number;
  senderName: string;
  sendingDomain: NewsletterSendingDomainState;
  timing?: "sendNow" | "schedule";
  linksDisabled?: boolean;
}) {
  const t = useTranslations("App.Projects.Newsletter.Issues.Readiness");
  const format = useFormatter();
  const verified = sendingDomain.sendingDomain?.status === "VERIFIED";
  const approved = Boolean(issue.approvedAt && issue.approvedByUserId);

  return (
    <section
      aria-label={t("title")}
      className={cn(HOLDER_CLASS, "@container min-w-0 space-y-2 p-2")}
    >
      <h3 className="text-muted-foreground px-2 pt-1 text-xs font-medium">
        {t("title")}
      </h3>
      <ul className="grid min-w-0 gap-2 @lg:grid-cols-2 @4xl:grid-cols-4">
        <ReadinessItem
          label={t("sender")}
          state={hasNewsletterSender(sendingDomain) ? "done" : "blocked"}
          value={
            verified
              ? senderName
              : sendingDomain.fallbackAvailable
                ? t("fallbackSender", { name: senderName })
                : t("noSender")
          }
          detail={
            verified
              ? sendingDomain.sendingDomain?.fromAddress
              : sendingDomain.fallbackAvailable
                ? t("fallbackHint")
                : null
          }
          fix={
            linksDisabled ? null : (
              <Link
                className="inline-block py-1 underline underline-offset-4"
                href={`${newsletterHref("/newsletter/settings", projectId)}#newsletter-sending-domain`}
              >
                {t("senderSettings")}
              </Link>
            )
          }
        />
        <ReadinessItem
          label={t("audience")}
          state={activeSubscribers > 0 ? "done" : "blocked"}
          value={t("audienceCount", { count: activeSubscribers })}
          numeric
          detail={activeSubscribers === 0 ? t("noSubscribers") : null}
          fix={
            linksDisabled ? null : (
              <Link
                className="inline-block py-1 underline underline-offset-4"
                href={newsletterHref("/newsletter/subscribers", projectId)}
              >
                {t("manageSubscribers")}
              </Link>
            )
          }
        />
        <ReadinessItem
          label={t("approval")}
          state={approved ? "done" : "pending"}
          value={approved ? t("approved") : t("approvalRequired")}
        />
        <ReadinessItem
          label={t("timing")}
          state={timing || issue.scheduledAt ? "done" : "pending"}
          value={
            timing === "sendNow"
              ? t("afterConfirmation")
              : timing === "schedule"
                ? t("selectedTime")
                : issue.scheduledAt
                  ? t("scheduled", {
                      date: format.dateTime(issue.scheduledAt, "dateTime", {
                        timeZone: issue.timezone ?? "UTC",
                      }),
                      timezone: issue.timezone ?? "UTC",
                    })
                  : t("chooseTiming")
          }
        />
      </ul>
      <p className="text-muted-foreground px-2 pb-1 text-xs">
        {t("deliveryHint")}
      </p>
    </section>
  );
}

function ReadinessItem({
  label,
  state,
  value,
  detail,
  fix,
  numeric = false,
}: {
  label: string;
  state: CheckState;
  value: string;
  detail?: string | null;
  fix?: React.ReactNode;
  numeric?: boolean;
}) {
  const Icon =
    state === "done" ? Check : state === "blocked" ? CircleAlert : Circle;
  return (
    <li
      data-state={state}
      className={cn(HOLDER_ITEM_CLASS, "flex min-w-0 items-start gap-3 p-3")}
    >
      <span
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
          state === "done" &&
            "bg-semantic-success text-semantic-success-foreground",
          state === "blocked" &&
            "bg-semantic-warning text-semantic-warning-foreground",
          state === "pending" && "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-3" />
      </span>
      <div className="min-w-0 space-y-0.5 text-sm wrap-anywhere">
        <p className="text-muted-foreground text-xs">{label}</p>
        <p className={cn("font-medium", numeric && "tabular-nums")}>{value}</p>
        {detail ? <p className="text-muted-foreground">{detail}</p> : null}
        {fix}
      </div>
    </li>
  );
}
