"use client";

import type {
  NewsletterDnsRecord,
  NewsletterSendingDomain,
  NewsletterSendingDomainState,
} from "@sokosumi/core-client";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleDotDashed,
  Clock,
  ExternalLink,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import {
  createElement,
  type FormEvent,
  Fragment,
  type ReactNode,
  useId,
  useState,
} from "react";
import { toast } from "sonner";
import { z } from "zod";

import { CopyableValue } from "@/components/copyable-value";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  checkNewsletterSendingDomain,
  connectNewsletterSendingDomainWithCloudflare,
  removeNewsletterSendingDomain,
  resumeNewsletterSendingDomainWarmup,
  saveNewsletterSendingDomain,
} from "@/lib/actions/newsletter/sending-domain";
import { cn } from "@/lib/utils";

const domainConnectResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    value: z
      .object({
        providerName: z.string().min(1),
        applyUrl: z.url({ protocol: /^https$/ }),
      })
      .nullable(),
  }),
  z.object({
    ok: z.literal(false),
    error: z.object({ message: z.string() }),
  }),
]);

// Status chips are neutral; the glyph and the word carry the state.
// Verified alone fills green: success is the one state worth celebrating.
const STATUS_ICON = {
  PENDING: Clock,
  PARTIAL: CircleDotDashed,
  VERIFIED: CircleCheck,
  FAILED: CircleAlert,
} as const;

type RecordPurpose = "dkim" | "spf" | "bounce" | "dmarc" | "other";

function recordPurpose(record: NewsletterDnsRecord): RecordPurpose {
  if (record.record === "DKIM") return "dkim";
  if (record.record === "DMARC") return "dmarc";
  // Resend files the return path under SPF as an MX or a CNAME; only TXT is SPF.
  if (record.record === "SPF") return record.type === "TXT" ? "spf" : "bounce";
  return "other";
}

type RecordHealth = "found" | "missing" | "wrongValue";

const HEALTH_CHIP = {
  found: { icon: CircleCheck, className: "text-foreground" },
  missing: { icon: CircleDashed, className: "text-muted-foreground" },
  wrongValue: { icon: CircleAlert, className: "text-semantic-destructive" },
} as const;

const HEALTH_ROW_ORDER: RecordPurpose[] = [
  "dkim",
  "bounce",
  "spf",
  "dmarc",
  "other",
];

function recordHealth(record: NewsletterDnsRecord): RecordHealth {
  if (record.status === "verified") return "found";
  return record.status === "failed" ? "wrongValue" : "missing";
}

function requiredRecordCounts(records: NewsletterDnsRecord[]) {
  // DMARC is a suggestion: verification does not wait for it.
  const required = records.filter((record) => record.record !== "DMARC");
  return {
    found: required.filter((record) => record.status === "verified").length,
    total: required.length,
  };
}

// Client-safe counterpart of Core's relativeHost; no DNS lookup is needed here.
function relativeHost(fqdn: string, domain: string): string | null {
  const host = fqdn.toLowerCase().replace(/\.$/, "");
  const zone = domain.toLowerCase().replace(/\.$/, "");
  if (host === zone) return "@";
  return host.endsWith(`.${zone}`) ? host.slice(0, -zone.length - 1) : null;
}

// <wbr> after dots: long hosts wrap between labels, and copying keeps the exact value.
function softBreaks(value: string) {
  return createElement(
    Fragment,
    null,
    ...value
      .split(/(?<=[.@])/)
      .flatMap((part, index) =>
        index ? [createElement("wbr"), part] : [part],
      ),
  );
}

interface SendingDomainCardProps {
  state: NewsletterSendingDomainState;
  projectId: string;
}

/**
 * This project's own From address. Project members can connect and manage
 * its sending domain from the newsletter settings.
 */
export function SendingDomainCard({
  state,
  projectId,
}: SendingDomainCardProps) {
  const t = useTranslations("App.Projects.Newsletter.SendingDomain");
  const { sendingDomain, canManage, fallbackAvailable } = state;

  return (
    <section aria-labelledby="newsletter-sending-domain">
      <Card>
        <CardHeader>
          <CardTitle>
            <h3 id="newsletter-sending-domain">{t("title")}</h3>
          </CardTitle>
          {sendingDomain ? null : (
            <CardDescription>{t("description")}</CardDescription>
          )}
        </CardHeader>
        <CardContent className="min-w-0 space-y-6">
          {sendingDomain ? (
            <ConnectedDomain
              key={sendingDomain.id}
              domain={sendingDomain}
              canManage={canManage}
              fallbackAvailable={fallbackAvailable}
              projectId={projectId}
            />
          ) : canManage ? (
            <AddDomainForm
              fallbackAvailable={fallbackAvailable}
              projectId={projectId}
            />
          ) : (
            <FallbackNote fallbackAvailable={fallbackAvailable} />
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function FallbackNote({ fallbackAvailable }: { fallbackAvailable: boolean }) {
  const t = useTranslations("App.Projects.Newsletter.SendingDomain");
  return (
    <p className="text-muted-foreground text-sm text-pretty">
      {fallbackAvailable ? t("fallback") : t("noFallback")}
    </p>
  );
}

function AddDomainForm({
  fallbackAvailable,
  projectId,
}: {
  fallbackAvailable: boolean;
  projectId: string;
}) {
  const t = useTranslations("App.Projects.Newsletter.SendingDomain");
  const router = useRouter();
  const [fromAddress, setFromAddress] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const result = await saveNewsletterSendingDomain({
        projectId,
        fromAddress,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      toast.success(t("added"));
      router.refresh();
    } catch {
      setError(t("errors.generic"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="min-w-0 space-y-3">
      <div className="space-y-2">
        <Label htmlFor="newsletter-from-address">{t("fromAddress")}</Label>
        <div className="flex min-w-0 flex-wrap gap-2">
          <Input
            id="newsletter-from-address"
            name="fromAddress"
            type="email"
            autoComplete="off"
            inputMode="email"
            placeholder={t("fromAddressPlaceholder")}
            value={fromAddress}
            onChange={(event) => setFromAddress(event.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={
              error
                ? "newsletter-from-address-error"
                : "newsletter-from-address-hint"
            }
            className="min-w-0 flex-1 basis-56"
          />
          <Button type="submit" variant="primary" loading={pending}>
            {t("add")}
          </Button>
        </div>
        {error ? (
          <p
            id="newsletter-from-address-error"
            role="alert"
            className="text-semantic-destructive text-sm"
          >
            {error}
          </p>
        ) : (
          <p
            id="newsletter-from-address-hint"
            className="text-muted-foreground text-sm text-pretty"
          >
            {t("fromAddressHint")}
          </p>
        )}
      </div>
      <FallbackNote fallbackAvailable={fallbackAvailable} />
    </form>
  );
}

interface ConnectedDomainProps {
  domain: NewsletterSendingDomain;
  canManage: boolean;
  fallbackAvailable: boolean;
  projectId: string;
}

function ConnectedDomain({
  domain,
  canManage,
  fallbackAvailable,
  projectId,
}: ConnectedDomainProps) {
  const t = useTranslations("App.Projects.Newsletter.SendingDomain");
  const format = useFormatter();
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const [hasChecked, setHasChecked] = useState(false);
  const [recordsOverride, setRecordsOverride] = useState<boolean | null>(null);
  const verified = domain.status === "VERIFIED";
  const paused = Boolean(domain.warmup.pausedAt);
  // Core lists a suggested DMARC record only while the domain lacks a policy.
  const dmarcMissing = domain.dnsRecords.some(
    (record) => record.record === "DMARC" && record.status !== "verified",
  );
  const needsDns = !verified || dmarcMissing;
  const recordCounts = requiredRecordCounts(domain.dnsRecords);
  const displayStatus =
    domain.status === "PENDING" &&
    recordCounts.found > 0 &&
    recordCounts.found < recordCounts.total
      ? "PARTIAL"
      : domain.status;
  const StatusIcon = STATUS_ICON[displayStatus];
  const discovery = useDomainConnect(projectId, domain, canManage && needsDns);
  const { provider } = discovery;
  // Failed points at the records; otherwise they wait until asked for.
  const recordsOpen = recordsOverride ?? domain.status === "FAILED";
  const warming =
    verified &&
    !paused &&
    Boolean(domain.warmup.startedAt) &&
    domain.warmup.dailyCap !== null;
  const statusHint = [
    !verified && !paused
      ? t(fallbackAvailable ? "fallback" : "noFallback")
      : null,
    domain.lastCheckedAt
      ? t("lastChecked", {
          time: format.dateTime(
            new Date(domain.lastCheckedAt),
            "dateTimeMedium",
          ),
        })
      : null,
  ]
    .filter(Boolean)
    .join(" ");
  const statusBadge = (
    <Badge
      className={
        verified
          ? "bg-semantic-success text-semantic-success-foreground border-transparent"
          : "border-border bg-muted text-foreground"
      }
    >
      <StatusIcon aria-hidden />
      {t(`status.${displayStatus}`)}
    </Badge>
  );

  async function handleCheck() {
    setChecking(true);
    try {
      const result = await checkNewsletterSendingDomain({ projectId });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      setHasChecked(true);
      if (result.value.status === "VERIFIED") {
        toast.success(t("verifiedToast"));
      } else {
        // The toast points at each record's status, so show them.
        setRecordsOverride(true);
        toast.info(t("checked", requiredRecordCounts(result.value.dnsRecords)));
      }
      router.refresh();
    } catch {
      toast.error(t("errors.generic"));
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="min-w-0 space-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="min-w-0 font-mono text-base font-medium break-words">
            {softBreaks(domain.fromAddress)}
          </span>
          {statusHint ? (
            <Hint hint={statusHint}>{statusBadge}</Hint>
          ) : (
            statusBadge
          )}
          {warming ? <WarmupChip warmup={domain.warmup} /> : null}
        </div>
        {domain.status === "FAILED" && domain.failureReason ? (
          <p
            role="status"
            className="text-semantic-destructive text-sm break-words"
          >
            {domain.failureReason}
          </p>
        ) : null}
        {domain.status === "FAILED" ? (
          canManage ? (
            <p className="text-muted-foreground text-sm text-pretty">
              {t("statusDetail.FAILED")}
            </p>
          ) : null
        ) : !verified && recordCounts.total ? (
          <p className="text-muted-foreground text-sm tabular-nums">
            {t("recordsFound", recordCounts)}
          </p>
        ) : null}
        {verified ? null : <PurposeHealthRow records={domain.dnsRecords} />}
        {verified && dmarcMissing ? (
          <RecordHint
            label={t("dmarc.title")}
            hint={t("dmarc.description")}
            className="text-muted-foreground text-sm"
          />
        ) : null}
      </div>

      {paused ? (
        <WarmupPausedNotice
          warmup={domain.warmup}
          canManage={canManage}
          projectId={projectId}
        />
      ) : null}

      <Collapsible
        open={recordsOpen}
        onOpenChange={setRecordsOverride}
        className="min-w-0 space-y-4"
      >
        {canManage && !verified ? (
          <DiscoveryStatus discovery={discovery} />
        ) : null}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {canManage && needsDns ? (
            <>
              {provider ? (
                <Button asChild variant={verified ? "outline" : "primary"}>
                  {/* Domain Connect's synchronous flow returns here when done. */}
                  <a href={provider.applyUrl} rel="noopener noreferrer">
                    {t("oneClick.connect", { provider: provider.providerName })}
                    <ExternalLink aria-hidden />
                  </a>
                </Button>
              ) : null}
              <Button
                type="button"
                variant={provider || verified ? "outline" : "primary"}
                loading={checking}
                onClick={() => void handleCheck()}
              >
                {domain.lastCheckedAt || hasChecked
                  ? t("checkAgain")
                  : t("verifyRecords")}
              </Button>
            </>
          ) : null}
          {domain.dnsRecords.length ? (
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="[&[data-state=open]>svg]:rotate-180"
              >
                {canManage && needsDns
                  ? t("manual.action")
                  : t("records.title")}
                <ChevronDown aria-hidden />
              </Button>
            </CollapsibleTrigger>
          ) : null}
          {canManage ? (
            <div className="ms-auto">
              <RemoveDomainButton
                domain={domain.domain}
                projectId={projectId}
              />
            </div>
          ) : null}
        </div>

        <CollapsibleContent className="min-w-0 space-y-4">
          <DnsRecords records={domain.dnsRecords} domain={domain.domain} />
          {needsDns ? (
            <Accordion type="single" collapsible>
              {domain.dnsRecords.some(
                (record) => record.status !== "verified",
              ) ? (
                <AccordionItem value="troubleshooting">
                  <AccordionTrigger>
                    {t("troubleshooting.title")}
                  </AccordionTrigger>
                  <AccordionContent>
                    <ul className="text-muted-foreground list-disc space-y-1 ps-5 text-sm">
                      <li>{t("troubleshooting.host")}</li>
                      <li>{t("troubleshooting.quotes")}</li>
                      <li>{t("troubleshooting.propagation")}</li>
                    </ul>
                  </AccordionContent>
                </AccordionItem>
              ) : null}
              <ProviderTips />
              {canManage ? (
                <AccordionItem value="cloudflare">
                  <AccordionTrigger>
                    {t("cloudflare.advanced")}
                  </AccordionTrigger>
                  <AccordionContent>
                    <CloudflareOption projectId={projectId} />
                  </AccordionContent>
                </AccordionItem>
              ) : null}
            </Accordion>
          ) : null}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function PurposeHealthRow({ records }: { records: NewsletterDnsRecord[] }) {
  const t = useTranslations("App.Projects.Newsletter.SendingDomain");
  if (!records.length) return null;
  return (
    <ul
      aria-label={t("records.title")}
      className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-sm"
    >
      {HEALTH_ROW_ORDER.map((purpose) => {
        const healths = records
          .filter((record) => recordPurpose(record) === purpose)
          .map(recordHealth);
        if (!healths.length) return null;
        // A purpose can span several records; it reads as its worst one.
        const health =
          (["wrongValue", "missing"] as const).find((worst) =>
            healths.includes(worst),
          ) ?? "found";
        const { icon: Icon, className } = HEALTH_CHIP[health];
        return (
          <li key={purpose} className={`flex items-center ${className}`}>
            <Hint
              // A missing DMARC record is optional, so its chip says what to do.
              hint={
                purpose === "dmarc" && health !== "found"
                  ? t("dmarc.description")
                  : t(`records.purpose.${purpose}.explanation`)
              }
              className="gap-1"
            >
              <Icon aria-hidden className="size-4 shrink-0" />
              {t(`records.purpose.${purpose}.label`)}
              <span className="sr-only">{t(`records.${health}`)}</span>
            </Hint>
          </li>
        );
      })}
    </ul>
  );
}

// Only while a daily cap applies; the chip's tooltip explains the limit.
function WarmupChip({ warmup }: { warmup: NewsletterSendingDomain["warmup"] }) {
  const t = useTranslations("App.Projects.Newsletter.SendingDomain");
  const format = useFormatter();
  return (
    <Hint hint={t("warmup.description")}>
      <Badge variant="outline" className="text-muted-foreground font-normal">
        {t("warmup.chip", {
          used: format.number(warmup.sentToday),
          cap: format.number(warmup.dailyCap ?? 0),
        })}
      </Badge>
    </Hint>
  );
}

function WarmupPausedNotice({
  warmup,
  canManage,
  projectId,
}: {
  warmup: NewsletterSendingDomain["warmup"];
  canManage: boolean;
  projectId: string;
}) {
  const t = useTranslations("App.Projects.Newsletter.SendingDomain");
  const format = useFormatter();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function handleResume() {
    setPending(true);
    setError("");
    try {
      const result = await resumeNewsletterSendingDomainWarmup({ projectId });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      toast.success(t("warmup.resumed"));
      router.refresh();
    } catch {
      setError(t("errors.generic"));
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      aria-labelledby="newsletter-domain-warmup"
      className="bg-semantic-warning-quinary border-semantic-warning-tertiary min-w-0 space-y-2 rounded-md border p-3"
    >
      <h4 id="newsletter-domain-warmup" className="text-sm font-medium">
        {t("warmup.paused")}
      </h4>
      <p className="text-sm tabular-nums">
        {warmup.dailyCap === null
          ? t("warmup.unlimited", {
              day: warmup.day ?? 0,
              used: format.number(warmup.sentToday),
            })
          : t("warmup.progress", {
              day: warmup.day ?? 0,
              used: format.number(warmup.sentToday),
              cap: format.number(warmup.dailyCap),
            })}
      </p>
      <p className="text-sm">
        {warmup.pauseReason === "COMPLAINT_RATE"
          ? t("warmup.complaintReason")
          : t("warmup.bounceReason")}
      </p>
      <p className="text-muted-foreground text-sm text-pretty">
        {t("warmup.pausedDescription")}
      </p>
      {canManage ? (
        <Button
          type="button"
          variant="outline"
          loading={pending}
          onClick={() => void handleResume()}
        >
          {t("warmup.resume")}
        </Button>
      ) : null}
      {error ? (
        <p role="alert" className="text-semantic-destructive-label text-sm">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function useDomainConnect(
  projectId: string,
  domain: NewsletterSendingDomain,
  enabled: boolean,
) {
  const t = useTranslations("App.Projects.Newsletter.SendingDomain");
  const query = useQuery({
    // Only what the apply URL depends on: a check that changes neither must
    // not look the provider up again.
    queryKey: [
      "newsletter-domain-connect",
      projectId,
      domain.id,
      domain.status === "VERIFIED",
      domain.dnsRecords.map(
        (record) => `${record.type}:${record.name}:${record.value}`,
      ),
    ],
    queryFn: async ({ signal }) => {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/newsletter/sending-domain/domain-connect`,
        { cache: "no-store", signal },
      ).catch(() => {
        throw new Error(t("errors.generic"));
      });
      const parsed = domainConnectResultSchema.safeParse(
        await response.json().catch(() => null),
      );
      if (!parsed.success) throw new Error(t("errors.generic"));
      const result = parsed.data;
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      if (!response.ok) throw new Error(t("errors.generic"));
      return result.value;
    },
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
  });
  // Survives a retry, so the records stay as they are while it runs.
  const discovered = query.error ? null : (query.data ?? null);
  return {
    data: query.data,
    error: query.error,
    isFetching: query.isFetching,
    refetch: query.refetch,
    provider: query.isFetching ? null : discovered,
  };
}

function DiscoveryStatus({
  discovery,
}: {
  discovery: ReturnType<typeof useDomainConnect>;
}) {
  const t = useTranslations("App.Projects.Newsletter.SendingDomain");
  const { provider, isFetching, error, data, refetch } = discovery;

  // The Connect button already says it all.
  if (provider) return null;

  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
      <p role="status" className="text-muted-foreground empty:hidden">
        {isFetching
          ? t("oneClick.checking")
          : !error && data === null
            ? t("oneClick.unavailable")
            : null}
      </p>
      {error && !isFetching ? (
        <p role="alert" className="text-semantic-destructive">
          {error.message}
        </p>
      ) : null}
      {isFetching ? null : (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0"
          onClick={() => void refetch()}
        >
          {t("oneClick.lookup")}
        </Button>
      )}
    </div>
  );
}

function CloudflareOption({ projectId }: { projectId: string }) {
  const t = useTranslations("App.Projects.Newsletter.SendingDomain");
  const router = useRouter();
  const [apiToken, setApiToken] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const result = await connectNewsletterSendingDomainWithCloudflare({
        projectId,
        apiToken,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setApiToken("");
      toast.success(t("cloudflare.success"));
      router.refresh();
    } catch {
      setError(t("errors.generic"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      className="bg-muted min-w-0 space-y-2 rounded-md p-3"
    >
      <Label htmlFor="newsletter-cloudflare-token">
        {t("cloudflare.title")}
      </Label>
      <p
        id="newsletter-cloudflare-token-hint"
        className="text-muted-foreground text-sm text-pretty"
      >
        {t("cloudflare.description")}
      </p>
      <div className="flex min-w-0 flex-wrap gap-2">
        <Input
          id="newsletter-cloudflare-token"
          name="apiToken"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={apiToken}
          onChange={(event) => setApiToken(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            error
              ? "newsletter-cloudflare-token-error newsletter-cloudflare-token-hint"
              : "newsletter-cloudflare-token-hint"
          }
          className="bg-background min-w-0 flex-1 basis-56"
        />
        <Button type="submit" variant="outline" loading={pending}>
          {t("cloudflare.submit")}
        </Button>
      </div>
      {error ? (
        <p
          id="newsletter-cloudflare-token-error"
          role="alert"
          className="text-semantic-destructive text-sm"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}

function DnsRecords({
  records,
  domain,
}: {
  records: NewsletterDnsRecord[];
  domain: string;
}) {
  const t = useTranslations("App.Projects.Newsletter.SendingDomain");
  if (!records.length) return null;
  return (
    <section
      aria-label={t("records.title")}
      className="@container min-w-0 space-y-3"
    >
      <ul className="min-w-0 space-y-2">
        {records.map((record) => {
          const relativeName = relativeHost(record.name, domain);
          const purpose = recordPurpose(record);
          // Resend's "failed" cannot distinguish absent DNS from a wrong value, so unverified records show Missing
          // unless failed; failed records show Wrong value with guidance covering both possibilities.
          const found = record.status === "verified";
          return (
            <li
              key={`${record.type}:${record.name}:${record.value}`}
              className="bg-muted min-w-0 space-y-2 rounded-md p-3"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <RecordHint
                  label={t(`records.purpose.${purpose}.label`)}
                  hint={t(`records.purpose.${purpose}.explanation`)}
                  className="font-medium"
                />
                <Badge variant="outline" className="bg-background font-mono">
                  {record.type}
                </Badge>
                <Badge variant="outline" className="bg-background ms-auto">
                  {found ? (
                    <CircleCheck aria-hidden />
                  ) : (
                    <CircleAlert aria-hidden />
                  )}
                  {t(`records.${recordHealth(record)}`)}
                </Badge>
              </div>
              <dl className="min-w-0 space-y-2 text-sm">
                <RecordField
                  label={
                    relativeName !== null ? (
                      // The troubleshooting and provider tips check against this FQDN.
                      <RecordHint
                        label={t("records.relativeName")}
                        hint={`${t("records.fullName")}: ${record.name}`}
                      />
                    ) : (
                      t("records.fullName")
                    )
                  }
                  value={relativeName ?? record.name}
                />
                <RecordField
                  label={t("records.value")}
                  value={record.value}
                  truncate
                />
                {record.priority !== null ? (
                  <div className="text-muted-foreground flex gap-1 text-xs tabular-nums">
                    <dt>{t("records.priority")}</dt>
                    <dd>{record.priority}</dd>
                  </div>
                ) : null}
              </dl>
              {record.status === "failed" ? (
                <p className="text-muted-foreground text-sm text-pretty">
                  {t("records.failedDescription")}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// A short value keeps its label's line, even on a phone; a long one wraps below it.
function RecordField({
  label,
  value,
  truncate = false,
}: {
  label: ReactNode;
  value: string;
  truncate?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 @md:grid @md:grid-cols-[8rem_minmax(0,1fr)]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className="min-w-0 flex-1 basis-40"
        title={truncate ? value : undefined}
      >
        <CopyableValue
          value={value}
          displayValue={softBreaks(value)}
          presentation="inline-code"
          truncateInline={truncate}
          copiedFeedback
          codeClassName={truncate ? undefined : "min-w-0 break-words"}
          containerClassName="bg-background justify-between rounded-md px-2"
        />
      </dd>
    </div>
  );
}

function RecordHint({
  label,
  hint,
  className,
}: {
  label: string;
  hint: string;
  className?: string;
}) {
  return (
    <Hint
      hint={hint}
      className={cn(
        "decoration-muted-foreground min-h-6 underline decoration-dotted underline-offset-4",
        className,
      )}
    >
      {label}
    </Hint>
  );
}

// Hover, keyboard focus and a tap all show the hint; screen readers always get it.
function Hint({
  hint,
  className,
  children,
}: {
  hint: string;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const descriptionId = useId();
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger
        type="button"
        aria-describedby={descriptionId}
        className={cn(
          "focus-visible:ring-ring inline-flex w-fit cursor-help items-center rounded-sm outline-none focus-visible:ring-2",
          className,
        )}
        onClick={(event) => {
          // Radix closes on click, and on touch a click is the only way to open.
          event.preventDefault();
          setOpen((current) => !current);
        }}
      >
        {children}
      </TooltipTrigger>
      <span className="sr-only" id={descriptionId}>
        {hint}
      </span>
      <TooltipContent
        className="max-w-64 break-words text-pretty"
        side="top"
        sideOffset={6}
      >
        {hint}
      </TooltipContent>
    </Tooltip>
  );
}

function ProviderTips() {
  const t = useTranslations("App.Projects.Newsletter.SendingDomain");
  return (
    <AccordionItem value="provider-tips">
      <AccordionTrigger>{t("providerTips.title")}</AccordionTrigger>
      <AccordionContent className="space-y-3">
        <p className="text-muted-foreground text-sm text-pretty">
          {t("providerTips.description")}
        </p>
        <ul className="text-muted-foreground list-disc space-y-1 ps-5 text-sm">
          <li>{t("providerTips.common.host")}</li>
          <li>{t("providerTips.common.quotes")}</li>
          <li>{t("providerTips.common.apex")}</li>
          <li>{t("providerTips.common.ttl")}</li>
        </ul>
        <Accordion type="single" collapsible>
          {[
            "godaddy",
            "namecheap",
            "squarespace",
            "porkbun",
            "ionos",
            "hostinger",
            "route53",
            "vercel",
            "cloudflare",
          ].map((provider) => (
            <AccordionItem key={provider} value={provider}>
              <AccordionTrigger>
                {t(`providerTips.providers.${provider}.name`)}
              </AccordionTrigger>
              <AccordionContent>
                <ul className="text-muted-foreground list-disc space-y-1 ps-5">
                  <li>{t(`providerTips.providers.${provider}.host`)}</li>
                  <li>{t(`providerTips.providers.${provider}.extra`)}</li>
                </ul>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </AccordionContent>
    </AccordionItem>
  );
}

function RemoveDomainButton({
  domain,
  projectId,
}: {
  domain: string;
  projectId: string;
}) {
  const t = useTranslations("App.Projects.Newsletter.SendingDomain");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function handleRemove() {
    setPending(true);
    setError("");
    try {
      const result = await removeNewsletterSendingDomain({ projectId });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setOpen(false);
      toast.success(t("remove.success"));
      router.refresh();
    } catch {
      setError(t("errors.generic"));
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(value) => {
        if (!pending) {
          setOpen(value);
          setError("");
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button type="button" variant="ghost" className="text-muted-foreground">
          {t("remove.action")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("remove.title")}</AlertDialogTitle>
          <AlertDialogDescription className="break-words">
            {t("remove.description", { domain })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p role="alert" className="text-semantic-destructive text-sm">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {t("remove.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            loading={pending}
            className="bg-semantic-destructive-solid text-semantic-destructive-foreground hover:bg-destructive-hover"
            onClick={(event) => {
              event.preventDefault();
              void handleRemove();
            }}
          >
            {t("remove.action")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
