"use client";

import type {
  NewsletterDnsRecord,
  NewsletterSendingDomain,
  NewsletterSendingDomainConnect,
  NewsletterSendingDomainState,
} from "@sokosumi/core-client";
import { CircleAlert, CircleCheck, Clock, ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { CopyableValue } from "@/components/copyable-value";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  checkNewsletterSendingDomain,
  connectNewsletterSendingDomainWithCloudflare,
  getNewsletterSendingDomainConnect,
  removeNewsletterSendingDomain,
  saveNewsletterSendingDomain,
} from "@/lib/actions/newsletter/sending-domain";

const STATUS_STYLE = {
  PENDING: {
    icon: Clock,
    className:
      "border-transparent bg-semantic-warning-quaternary text-semantic-warning-label",
  },
  VERIFIED: {
    icon: CircleCheck,
    className:
      "border-transparent bg-semantic-success-quaternary text-semantic-success-label",
  },
  FAILED: {
    icon: CircleAlert,
    className:
      "border-transparent bg-semantic-destructive-quaternary text-semantic-destructive-label",
  },
} as const;

type RecordPurpose = "dkim" | "spf" | "bounce" | "dmarc" | "other";

function recordPurpose(record: NewsletterDnsRecord): RecordPurpose {
  if (record.record === "DKIM") return "dkim";
  if (record.record === "DMARC") return "dmarc";
  if (record.record === "SPF") return record.type === "MX" ? "bounce" : "spf";
  return "other";
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
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent className="min-w-0 space-y-6">
          {sendingDomain ? (
            <ConnectedDomain
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
            className="text-semantic-destructive-label text-sm"
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
  const { icon: StatusIcon, className: statusClassName } =
    STATUS_STYLE[domain.status];
  const verified = domain.status === "VERIFIED";
  // Core lists a suggested DMARC record only while the domain lacks a policy.
  const dmarcMissing = domain.dnsRecords.some(
    (record) => record.record === "DMARC" && record.status !== "verified",
  );
  const needsDns = !verified || dmarcMissing;

  async function handleCheck() {
    setChecking(true);
    try {
      const result = await checkNewsletterSendingDomain({ projectId });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success(
        result.value.status === "VERIFIED" ? t("verifiedToast") : t("checked"),
      );
      router.refresh();
    } catch {
      toast.error(t("errors.generic"));
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="min-w-0 space-y-6">
      <div className="min-w-0 space-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="min-w-0 font-mono text-sm font-medium wrap-anywhere">
            {domain.fromAddress}
          </span>
          <Badge className={statusClassName}>
            <StatusIcon aria-hidden />
            {t(`status.${domain.status}`)}
          </Badge>
        </div>
        {domain.lastCheckedAt ? (
          <p className="text-muted-foreground text-sm">
            {t("lastChecked", {
              time: format.dateTime(
                new Date(domain.lastCheckedAt),
                "dateTimeMedium",
              ),
            })}
          </p>
        ) : null}
        {domain.status === "FAILED" && domain.failureReason ? (
          <p
            role="status"
            className="text-semantic-destructive-label text-sm wrap-anywhere"
          >
            {domain.failureReason}
          </p>
        ) : null}
        {verified ? (
          <p className="text-muted-foreground text-sm text-pretty">
            {t("verifiedDescription")}
          </p>
        ) : (
          <FallbackNote fallbackAvailable={fallbackAvailable} />
        )}
      </div>

      {dmarcMissing ? (
        <div
          role="status"
          className="bg-semantic-warning-quinary border-semantic-warning-tertiary flex min-w-0 gap-2 rounded-md border p-3"
        >
          <CircleAlert
            aria-hidden
            className="text-semantic-warning-label mt-0.5 size-4 shrink-0"
          />
          <div className="min-w-0 space-y-1 text-sm">
            <p className="font-medium">{t("dmarc.title")}</p>
            <p className="text-muted-foreground text-pretty">
              {t("dmarc.description")}
            </p>
          </div>
        </div>
      ) : null}

      {canManage && needsDns ? (
        <div className="min-w-0 space-y-4">
          <h4 className="text-sm font-medium">{t("connectTitle")}</h4>
          <DomainConnectOption projectId={projectId} />
          <CloudflareOption projectId={projectId} />
        </div>
      ) : null}

      <DnsRecords records={domain.dnsRecords} />

      {canManage ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {needsDns ? (
            <Button
              type="button"
              variant="primary"
              loading={checking}
              onClick={() => void handleCheck()}
            >
              {t("checkNow")}
            </Button>
          ) : null}
          <RemoveDomainButton domain={domain.domain} projectId={projectId} />
        </div>
      ) : null}
    </div>
  );
}

function DomainConnectOption({ projectId }: { projectId: string }) {
  const t = useTranslations("App.Projects.Newsletter.SendingDomain");
  const [pending, setPending] = useState(false);
  const [connect, setConnect] = useState<
    NewsletterSendingDomainConnect | undefined
  >(undefined);
  const [error, setError] = useState("");

  async function handleLookup() {
    setPending(true);
    setError("");
    try {
      const result = await getNewsletterSendingDomainConnect({ projectId });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setConnect(result.value);
    } catch {
      setError(t("errors.generic"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="bg-muted min-w-0 space-y-2 rounded-md p-3">
      <p className="text-sm font-medium">{t("oneClick.title")}</p>
      {connect ? (
        <>
          <p className="text-muted-foreground text-sm text-pretty">
            {t("oneClick.found", { provider: connect.providerName })}
          </p>
          <Button asChild variant="primary" size="sm">
            {/* Domain Connect's synchronous flow returns here when done. */}
            <a href={connect.applyUrl} rel="noopener noreferrer">
              {t("oneClick.connect", { provider: connect.providerName })}
              <ExternalLink aria-hidden />
            </a>
          </Button>
        </>
      ) : (
        <>
          <p
            role={connect === null ? "status" : undefined}
            className="text-muted-foreground text-sm text-pretty"
          >
            {connect === null
              ? t("oneClick.unavailable")
              : t("oneClick.description")}
          </p>
          {connect === null ? null : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              loading={pending}
              onClick={() => void handleLookup()}
            >
              {t("oneClick.lookup")}
            </Button>
          )}
        </>
      )}
      {error ? (
        <p role="alert" className="text-semantic-destructive-label text-sm">
          {error}
        </p>
      ) : null}
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
          className="text-semantic-destructive-label text-sm"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}

function DnsRecords({ records }: { records: NewsletterDnsRecord[] }) {
  const t = useTranslations("App.Projects.Newsletter.SendingDomain");
  if (!records.length) return null;
  return (
    <section
      aria-labelledby="newsletter-dns-records"
      className="min-w-0 space-y-3"
    >
      <div className="space-y-1">
        <h4 id="newsletter-dns-records" className="text-sm font-medium">
          {t("records.title")}
        </h4>
        <p className="text-muted-foreground text-sm text-pretty">
          {t("records.description")}
        </p>
      </div>
      <ul className="min-w-0 space-y-3">
        {records.map((record) => (
          <li
            key={`${record.type}:${record.name}:${record.value}`}
            className="bg-muted min-w-0 space-y-2 rounded-md p-3"
          >
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Badge variant="outline" className="bg-background font-mono">
                {record.type}
              </Badge>
              <span className="text-sm font-medium">
                {t(`records.purpose.${recordPurpose(record)}.label`)}
              </span>
              {record.status === "verified" ? (
                <CircleCheck
                  aria-label={t("records.found")}
                  className="text-semantic-success size-4"
                />
              ) : null}
            </div>
            <p className="text-muted-foreground text-sm text-pretty">
              {t(`records.purpose.${recordPurpose(record)}.explanation`)}
            </p>
            <dl className="grid min-w-0 gap-2 text-sm sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:gap-x-3">
              <RecordField label={t("records.name")} value={record.name} />
              <RecordField label={t("records.value")} value={record.value} />
              {record.priority !== null ? (
                <RecordField
                  label={t("records.priority")}
                  value={String(record.priority)}
                />
              ) : null}
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RecordField({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">
        <CopyableValue
          value={value}
          presentation="inline-code"
          truncateInline={false}
          copiedFeedback
          codeClassName="min-w-0 wrap-anywhere"
          containerClassName="bg-background justify-between rounded-md px-2 py-1"
        />
      </dd>
    </>
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
        <Button type="button" variant="outline">
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
          <p role="alert" className="text-semantic-destructive-label text-sm">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {t("remove.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            loading={pending}
            className="bg-semantic-destructive-solid text-destructive-foreground hover:bg-destructive-hover"
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
