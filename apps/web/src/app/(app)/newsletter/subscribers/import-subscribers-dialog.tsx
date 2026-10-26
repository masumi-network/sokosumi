"use client";

import {
  NewsletterConsent,
  type NewsletterImportResult,
} from "@sokosumi/core-client";
import { Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { type FormEvent, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { importNewsletterSubscribers } from "@/lib/actions/newsletter/subscribers";
import { NEWSLETTER_CSV_MAX_BYTES } from "@/lib/schemas/newsletter-subscribers";
import { NewsletterConsentChoice } from "./newsletter-consent-choice";

interface ImportSubscribersDialogProps {
  projectId: string;
  newsletterName: string;
  onClose: () => void;
  onCloseAutoFocus: () => void;
}

export function ImportSubscribersDialog({
  projectId,
  newsletterName,
  onClose,
  onCloseAutoFocus,
}: ImportSubscribersDialogProps) {
  const t = useTranslations("App.Projects.Newsletter.Subscribers");
  const format = useFormatter();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState<NewsletterConsent>();
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [fileError, setFileError] = useState("");
  const [consentError, setConsentError] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<NewsletterImportResult | null>(null);

  function handleFile(selected: File | undefined) {
    setFile(null);
    setError("");
    setFileError("");
    if (!selected) return;
    if (!selected.name.toLowerCase().endsWith(".csv"))
      setFileError(t("Import.fileType"));
    else if (selected.size > NEWSLETTER_CSV_MAX_BYTES)
      setFileError(t("Import.fileSize"));
    else setFile(selected);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const hasConsent =
      !!consent &&
      (consent !== NewsletterConsent.CONFIRMED || consentConfirmed);
    setConsentError(hasConsent ? "" : t("Validation.consent"));
    if (!file) {
      if (!fileError) setFileError(t("Import.fileRequired"));
      input.current?.focus();
      return;
    }
    if (!hasConsent || !consent || pending) return;
    setPending(true);
    try {
      const csv = await file.text();
      const values = new FormData();
      // A Blob preserves line endings when multipart fields are encoded.
      values.set("csv", new Blob([csv], { type: "text/csv" }), file.name);
      values.set("consent", consent);
      values.set("consentConfirmed", String(consentConfirmed));
      const response = await importNewsletterSubscribers({
        projectId,
        values,
      });
      if (!response.ok) {
        setError(response.error.message);
        setFileError(response.error.fieldErrors?.csv?.[0] ?? "");
        setConsentError(response.error.fieldErrors?.consent?.[0] ?? "");
        return;
      }
      setResult(response.value);
      router.refresh();
    } catch {
      setError(t("Import.error"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onCloseAutoFocus();
        }}
        className="app-scrollbar max-h-[90dvh] overflow-y-auto overscroll-contain sm:max-w-lg"
      >
        <form noValidate onSubmit={handleSubmit} className="grid min-w-0 gap-5">
          <DialogHeader>
            <DialogTitle>{t("import")}</DialogTitle>
            <DialogDescription>
              {result ? t("Import.doneDescription") : t("Import.description")}
            </DialogDescription>
          </DialogHeader>
          {result ? (
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-3">
                {(
                  [
                    "imported",
                    "skippedExisting",
                    "skippedUnsubscribed",
                    "skippedBounced",
                    "pendingConfirmation",
                    "invalid",
                  ] as const
                ).map((key) => (
                  <div key={key} className="rounded-lg border p-3">
                    <dt className="text-muted-foreground text-sm">
                      {t(`Import.result.${key}`)}
                    </dt>
                    <dd className="text-2xl font-semibold tabular-nums">
                      {format.number(
                        key === "invalid" ? result.invalid.length : result[key],
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
              {result.invalid.length ? (
                <div className="space-y-2">
                  <p className="text-muted-foreground text-sm">
                    {t("Import.invalidHint")}
                  </p>
                  <ul className="space-y-1 text-sm">
                    {result.invalid.slice(0, 5).map((row) => (
                      <li key={row.row} className="break-all">
                        {t("Import.invalidRow", {
                          row: row.row,
                          value: row.value,
                        })}
                      </li>
                    ))}
                  </ul>
                  {result.invalid.length > 5 ? (
                    <p className="text-muted-foreground text-sm">
                      {t("Import.moreInvalid", {
                        count: result.invalid.length - 5,
                      })}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <fieldset disabled={pending} className="grid min-w-0 gap-5">
              <div className="space-y-2">
                <Label htmlFor="newsletter-csv">{t("Import.file")}</Label>
                <div className="ring-offset-background has-[:focus-visible]:ring-ring flex min-w-0 flex-wrap items-center gap-3 rounded-md has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-offset-2">
                  <Button
                    type="button"
                    aria-hidden
                    tabIndex={-1}
                    variant="outline"
                    onClick={() => input.current?.click()}
                  >
                    <Upload />
                    {t("Import.chooseFile")}
                  </Button>
                  <span
                    aria-hidden
                    className="text-muted-foreground min-w-0 text-sm break-all"
                  >
                    {file?.name ?? t("Import.noFile")}
                  </span>
                  <span className="sr-only">
                    <Input
                      ref={input}
                      id="newsletter-csv"
                      name="csv"
                      type="file"
                      required
                      accept=".csv,text/csv"
                      aria-invalid={!!fileError}
                      aria-describedby="newsletter-csv-hint newsletter-csv-error"
                      onChange={(event) => handleFile(event.target.files?.[0])}
                    />
                  </span>
                </div>
                <p
                  id="newsletter-csv-hint"
                  className="text-muted-foreground text-sm"
                >
                  {t("Import.fileHint")}
                </p>
                <p
                  id="newsletter-csv-error"
                  className="text-semantic-destructive-label text-sm"
                >
                  {fileError}
                </p>
              </div>
              <NewsletterConsentChoice
                newsletterName={newsletterName}
                value={consent}
                confirmed={consentConfirmed}
                onValueChange={setConsent}
                onConfirmedChange={setConsentConfirmed}
                error={consentError}
                disabled={pending}
              />
            </fieldset>
          )}
          <p role="status" className="text-muted-foreground text-sm">
            {pending
              ? t("Import.importing")
              : result
                ? t("Import.doneDescription")
                : null}
          </p>
          {error ? (
            <p role="alert" className="text-semantic-destructive-label text-sm">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            {result ? (
              <Button type="button" variant="primary" onClick={onClose}>
                {t("done")}
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={onClose}
                >
                  {t("cancel")}
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  loading={pending}
                  disabled={
                    !consent ||
                    (consent === NewsletterConsent.CONFIRMED &&
                      !consentConfirmed)
                  }
                >
                  {t("import")}
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
