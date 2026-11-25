"use client";
import type { ContactLinkedInImportResult } from "@sokosumi/core-client";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { coreErrorOf } from "@/app/contacts/contacts-view";
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
import { contactsService } from "@/lib/services/contacts.client";
import { refreshContacts } from "./use-contacts-data";

const MAX_BYTES = 5_000_000;

/**
 * Upload LinkedIn's Connections.csv: every connection becomes or updates a
 * contact, and the file's owner is recorded as connected to each of them.
 */
export function ImportLinkedInDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations("App.Contacts.linkedInImport");
  const cache = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ContactLinkedInImportResult | null>(
    null,
  );

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError(t("tooLarge"));
      return;
    }
    setPending(true);
    setError("");
    try {
      const summary = await contactsService.importLinkedIn(await file.text());
      setResult(summary);
      await refreshContacts(cache);
    } catch (caught) {
      setError(coreErrorOf(caught).message ?? t("failed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent showCloseButton={!pending} className="sm:max-w-lg">
        <form onSubmit={handleSubmit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>
              {result ? t("doneDescription") : t("description")}
            </DialogDescription>
          </DialogHeader>
          {result ? (
            <dl className="grid grid-cols-3 gap-3">
              {(["connections", "created", "updated"] as const).map((key) => (
                <div key={key} className="rounded-lg border p-3">
                  <dt className="text-muted-foreground text-xs">
                    {t(`result.${key}`)}
                  </dt>
                  <dd className="text-2xl font-semibold tabular-nums">
                    {result[key]}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <fieldset disabled={pending} className="grid gap-4">
              <ol className="text-muted-foreground list-decimal space-y-1 ps-5 text-sm">
                <li>{t("step1")}</li>
                <li>{t("step2")}</li>
                <li>{t("step3")}</li>
              </ol>
              <div className="grid gap-2">
                <Label htmlFor="linkedin-csv">{t("fileLabel")}</Label>
                <Input
                  id="linkedin-csv"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
              </div>
              {error ? (
                <p className="text-destructive text-sm" role="alert">
                  {error}
                </p>
              ) : null}
            </fieldset>
          )}
          <DialogFooter>
            {result ? (
              <Button type="button" onClick={onClose}>
                {t("done")}
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={pending}
                  onClick={onClose}
                >
                  {t("cancel")}
                </Button>
                <Button type="submit" loading={pending} disabled={!file}>
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
