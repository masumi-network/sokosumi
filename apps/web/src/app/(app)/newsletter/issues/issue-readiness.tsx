import type {
  NewsletterIssue,
  NewsletterSendingDomainState,
} from "@sokosumi/core-client";
import { Check, Circle, X } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { newsletterHref } from "@/app/newsletter/newsletter-tabs";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";

export function hasNewsletterSender(state: NewsletterSendingDomainState) {
  return state.sendingDomain?.status === "VERIFIED" || state.fallbackAvailable;
}

type CheckState = "ready" | "blocked" | "pending";

/** A filled mark per row: green and yellow are fills only, so the glyph stays neutral on top. */
function CheckMark({ state }: { state: CheckState }) {
  const Icon = state === "ready" ? Check : state === "blocked" ? X : Circle;
  return (
    <span
      aria-hidden
      className={cn(
        "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
        state === "ready" &&
          "bg-semantic-success text-semantic-success-foreground",
        state === "blocked" &&
          "bg-semantic-warning text-semantic-warning-foreground",
        state === "pending" && "bg-muted text-muted-foreground",
      )}
    >
      <Icon className={state === "pending" ? "size-2" : "size-3"} />
    </span>
  );
}

function CheckRow({
  state,
  label,
  children,
}: {
  state: CheckState;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 gap-3">
      <CheckMark state={state} />
      <div className="min-w-0 space-y-0.5">
        <dt className="text-muted-foreground">{label}</dt>
        <dd className="space-y-0.5 wrap-anywhere">{children}</dd>
      </div>
    </div>
  );
}

export function IssueReadiness({
  issue,
  projectId,
  activeSubscribers,
  senderName,
  sendingDomain,
  timing,
  linksDisabled = false,
  approvalDetails,
}: {
  issue: NewsletterIssue;
  projectId: string;
  activeSubscribers: number;
  senderName: string;
  sendingDomain: NewsletterSendingDomainState;
  timing?: "sendNow" | "schedule";
  linksDisabled?: boolean;
  /** Who approved and the approval Task, shown under the approval row. */
  approvalDetails?: ReactNode;
}) {
  const t = useTranslations("App.Projects.Newsletter.Issues.Readiness");
  const format = useFormatter();
  const verified = sendingDomain.sendingDomain?.status === "VERIFIED";
  const approved = Boolean(issue.approvedAt && issue.approvedByUserId);
  const timed = Boolean(timing || issue.scheduledAt);

  return (
    <section
      aria-label={t("title")}
      className={cn(HOLDER_ITEM_CLASS, "min-w-0 space-y-3 p-4")}
    >
      <h3 className="text-sm font-semibold">{t("title")}</h3>
      <dl className="min-w-0 space-y-3 text-sm">
        <CheckRow
          state={hasNewsletterSender(sendingDomain) ? "ready" : "blocked"}
          label={t("sender")}
        >
          <p className="font-medium">
            {verified
              ? senderName
              : sendingDomain.fallbackAvailable
                ? t("fallbackSender", { name: senderName })
                : t("noSender")}
          </p>
          {verified ? (
            <p>{sendingDomain.sendingDomain?.fromAddress}</p>
          ) : sendingDomain.fallbackAvailable ? (
            <p className="text-muted-foreground">{t("fallbackHint")}</p>
          ) : null}
          {!linksDisabled ? (
            <Link
              className="inline-block py-1 underline underline-offset-4"
              href={`${newsletterHref("/newsletter/settings", projectId)}#newsletter-sending-domain`}
            >
              {t("senderSettings")}
            </Link>
          ) : null}
        </CheckRow>
        <CheckRow
          state={activeSubscribers > 0 ? "ready" : "blocked"}
          label={t("audience")}
        >
          <p className="font-medium tabular-nums">
            {t("audienceCount", { count: activeSubscribers })}
          </p>
          {!linksDisabled ? (
            <Link
              className="inline-block py-1 underline underline-offset-4"
              href={newsletterHref("/newsletter/subscribers", projectId)}
            >
              {t("manageSubscribers")}
            </Link>
          ) : null}
        </CheckRow>
        <CheckRow state={approved ? "ready" : "pending"} label={t("approval")}>
          <p className="font-medium">
            {approved ? t("approved") : t("approvalRequired")}
          </p>
          {approvalDetails}
        </CheckRow>
        <CheckRow state={timed ? "ready" : "pending"} label={t("timing")}>
          <p className="font-medium">
            {timing === "sendNow"
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
                  : t("chooseTiming")}
          </p>
        </CheckRow>
      </dl>
      <p className="text-muted-foreground text-xs">{t("deliveryHint")}</p>
    </section>
  );
}
