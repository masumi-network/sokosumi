"use client";

import { postDriveFilesGoogleSheets } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

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
import { getBrowserCoreClient } from "@/lib/clients/core.browser.client";
import type { FileStore } from "@/lib/utils/file-search.client";

const SHEET_LINK = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]{20,}/;

/**
 * Paste a Google Sheets link; Core copies the sheet into the folder as an
 * .xlsx and reads it again every hour.
 */
export function DriveLinkSheetDialog({
  open,
  store,
  folder,
  onOpenChange,
  onLinked,
}: {
  open: boolean;
  store: FileStore;
  folder: string;
  onOpenChange: (open: boolean) => void;
  onLinked: () => void;
}) {
  const t = useTranslations("App.Drive.GoogleSheet");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);

  function close(next: boolean) {
    if (linking) return;
    if (!next) {
      setUrl("");
      setError(null);
    }
    onOpenChange(next);
  }

  async function link() {
    const address = url.trim();
    if (!SHEET_LINK.test(address)) {
      setError(t("notALink"));
      return;
    }
    setLinking(true);
    setError(null);
    const result = await postDriveFilesGoogleSheets({
      client: getBrowserCoreClient(),
      body: { url: address, folder, ...store },
      throwOnError: false,
    });
    setLinking(false);
    if (result.data) {
      toast.success(t("linked", { name: result.data.data.name }));
      onLinked();
      setUrl("");
      onOpenChange(false);
      return;
    }
    const status = result.response?.status;
    setError(
      status === 409
        ? t("nameTaken")
        : status === 422
          ? t("notShared")
          : t("failed"),
    );
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("dialogTitle")}</DialogTitle>
          <DialogDescription>{t("dialogDescription")}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void link();
          }}
        >
          <Input
            type="url"
            inputMode="url"
            autoComplete="off"
            aria-label={t("linkLabel")}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "link-sheet-error" : undefined}
            placeholder="https://docs.google.com/spreadsheets/d/…"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              setError(null);
            }}
            disabled={linking}
          />
          {error ? (
            <p
              id="link-sheet-error"
              role="alert"
              className="text-semantic-destructive text-sm"
            >
              {error}
            </p>
          ) : null}
          <DialogFooter className="mt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => close(false)}
              disabled={linking}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={linking || !url.trim()}>
              {linking ? t("linking") : t("link")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
