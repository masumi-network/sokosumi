import type {
  NewsletterIssue,
  NewsletterSendingDomainState,
} from "@sokosumi/core-client";
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
    <section aria-label={t("title")} className={cn(HOLDER_CLASS, "@container")}>
      <div className={cn(HOLDER_ITEM_CLASS, "min-w-0 space-y-3 p-4")}>
        <h3 className="text-sm font-semibold">{t("title")}</h3>
        <dl className="grid min-w-0 gap-4 text-sm @sm:grid-cols-2 @3xl:grid-cols-4">
          <div className="min-w-0 space-y-1">
            <dt className="text-muted-foreground">{t("sender")}</dt>
            <dd className="space-y-1 wrap-anywhere">
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
            </dd>
          </div>
          <div className="min-w-0 space-y-1">
            <dt className="text-muted-foreground">{t("audience")}</dt>
            <dd className="space-y-1 wrap-anywhere">
              <p className="font-medium tabular-nums">
                {t("audienceCount", { count: activeSubscribers })}
              </p>
              {activeSubscribers === 0 ? <p>{t("noSubscribers")}</p> : null}
              {!linksDisabled ? (
                <Link
                  className="inline-block py-1 underline underline-offset-4"
                  href={newsletterHref("/newsletter/subscribers", projectId)}
                >
                  {t("manageSubscribers")}
                </Link>
              ) : null}
            </dd>
          </div>
          <div className="min-w-0 space-y-1">
            <dt className="text-muted-foreground">{t("approval")}</dt>
            <dd className="font-medium wrap-anywhere">
              {approved ? t("approved") : t("approvalRequired")}
            </dd>
          </div>
          <div className="min-w-0 space-y-1">
            <dt className="text-muted-foreground">{t("timing")}</dt>
            <dd className="font-medium wrap-anywhere">
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
            </dd>
          </div>
        </dl>
        <p className="text-muted-foreground text-sm">{t("deliveryHint")}</p>
      </div>
    </section>
  );
}
