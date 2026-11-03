import type {
  NewsletterIssue,
  NewsletterSendingDomainState,
} from "@sokosumi/core-client";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { newsletterHref } from "@/app/newsletter/newsletter-tabs";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import {
  MARKER_ICONS,
  StatusMarker,
  type StatusMarkerSpec,
} from "@/components/ui/status-marker";
import { cn } from "@/lib/utils";

const READY: StatusMarkerSpec = {
  tone: { hue: "resolved", weight: "filled" },
  icon: MARKER_ICONS.completed,
};
const MISSING: StatusMarkerSpec = {
  tone: { hue: "blocked", weight: "filled" },
  icon: MARKER_ICONS.warning,
};
const PENDING: StatusMarkerSpec = {
  tone: { hue: "dormant", weight: "filled" },
  icon: MARKER_ICONS.queued,
};

/** One checklist row: the mark says ready, missing, or still to come; the text says what. */
function ReadinessTerm({
  spec,
  children,
}: {
  spec: StatusMarkerSpec;
  children: ReactNode;
}) {
  return (
    <dt className="text-muted-foreground flex items-center gap-2">
      <StatusMarker spec={spec} />
      {children}
    </dt>
  );
}

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
  framed = true,
}: {
  issue: NewsletterIssue;
  projectId: string;
  activeSubscribers: number;
  senderName: string;
  sendingDomain: NewsletterSendingDomainState;
  timing?: "sendNow" | "schedule";
  linksDisabled?: boolean;
  /** Off inside the step panel, which is already the card it sits on. */
  framed?: boolean;
}) {
  const t = useTranslations("App.Projects.Newsletter.Issues.Readiness");
  const format = useFormatter();
  const verified = sendingDomain.sendingDomain?.status === "VERIFIED";
  const approved = Boolean(issue.approvedAt && issue.approvedByUserId);
  const sender = hasNewsletterSender(sendingDomain);

  return (
    <section
      aria-label={t("title")}
      className={cn(framed && HOLDER_CLASS, "@container")}
    >
      <div
        className={cn(
          framed && [HOLDER_ITEM_CLASS, "p-4"],
          "min-w-0 space-y-3",
        )}
      >
        <h3 className="text-sm font-semibold">{t("title")}</h3>
        <dl className="grid min-w-0 gap-4 text-sm @sm:grid-cols-2 @3xl:grid-cols-4">
          <div className="min-w-0 space-y-1">
            <ReadinessTerm spec={sender ? READY : MISSING}>
              {t("sender")}
            </ReadinessTerm>
            <dd className="space-y-1 ps-5.5 wrap-anywhere">
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
            <ReadinessTerm spec={activeSubscribers > 0 ? READY : MISSING}>
              {t("audience")}
            </ReadinessTerm>
            <dd className="space-y-1 ps-5.5 wrap-anywhere">
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
            <ReadinessTerm spec={approved ? READY : PENDING}>
              {t("approval")}
            </ReadinessTerm>
            <dd className="ps-5.5 font-medium wrap-anywhere">
              {approved ? t("approved") : t("approvalRequired")}
            </dd>
          </div>
          <div className="min-w-0 space-y-1">
            <ReadinessTerm spec={issue.scheduledAt ? READY : PENDING}>
              {t("timing")}
            </ReadinessTerm>
            <dd className="ps-5.5 font-medium wrap-anywhere">
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
