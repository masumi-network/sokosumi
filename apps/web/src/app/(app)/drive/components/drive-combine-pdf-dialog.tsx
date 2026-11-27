"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { flushSync } from "react-dom";
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
import { FileTypeIcon } from "@/components/ui/file-icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { safeFileName, saveBlob } from "@/lib/files-archive";
import {
  combineDrivePdfs,
  DriveCombinePdfError,
} from "@/lib/utils/file-search.client";

export interface CombinePdfFile {
  pathname: string;
  name: string;
}

/**
 * Orders the selected PDFs and downloads them as one PDF. Nothing is saved
 * in Files and the originals never change; a source Core cannot read
 * downloads nothing.
 */
export function DriveCombinePdfDialog({
  files,
  onOpenChange,
  onCloseFocus,
}: {
  files: CombinePdfFile[] | null;
  onOpenChange: (open: boolean) => void;
  /** Where focus goes on close; the dialog opens from a plain button, not a trigger. */
  onCloseFocus: () => void;
}) {
  return (
    <Dialog open={files !== null} onOpenChange={onOpenChange}>
      {files ? (
        <CombineForm
          // A new selection starts from its own order and name.
          key={files.map((file) => file.pathname).join("\n")}
          initialFiles={files}
          onDone={() => onOpenChange(false)}
          onCloseFocus={onCloseFocus}
        />
      ) : null}
    </Dialog>
  );
}

function CombineForm({
  initialFiles,
  onDone,
  onCloseFocus,
}: {
  initialFiles: CombinePdfFile[];
  onDone: () => void;
  onCloseFocus: () => void;
}) {
  const t = useTranslations("App.Drive.CombinePdf");
  const [order, setOrder] = useState(initialFiles);
  const [name, setName] = useState(() => t("defaultName"));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  function move(index: number, by: -1 | 1, button: HTMLButtonElement) {
    const next = [...order];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    flushSync(() => setOrder(next));
    // At the first or last place this arrow turns disabled and the browser
    // drops focus; keep it on the same file's other arrow.
    if (button.disabled)
      button
        .closest("li")
        ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
        ?.focus();
  }

  async function combine() {
    setBusy(true);
    setProblem(null);
    const trimmed = name.trim();
    const fileName = safeFileName(
      /\.pdf$/i.test(trimmed) ? trimmed : `${trimmed}.pdf`,
      "Combined.pdf",
    );
    try {
      const pdf = await combineDrivePdfs({
        pathnames: order.map((file) => file.pathname),
        filename: trimmed,
      });
      saveBlob(pdf, fileName);
      toast.success(t("downloaded", { name: fileName }));
      onDone();
    } catch (error) {
      setProblem(problemText(error));
    } finally {
      setBusy(false);
    }
  }

  function problemText(error: unknown): string {
    if (!(error instanceof DriveCombinePdfError)) return t("failed");
    const file = error.fileName;
    switch (error.kind) {
      case "too_large":
        return t("tooLarge");
      case "unreadable_pdf":
        return file ? t("unreadable", { name: file }) : t("failed");
      case "mixed_data_room":
        return t("mixedRoom");
      default:
        return t("failed");
    }
  }

  return (
    <DialogContent
      className="max-h-[92dvh] overflow-y-auto overscroll-contain sm:max-w-lg"
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        onCloseFocus();
      }}
    >
      <form
        // A grid item; min-w-0 lets long names truncate instead of widening the dialog.
        className="flex min-w-0 flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void combine();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("title", { count: order.length })}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <ol className="flex max-h-[45dvh] flex-col divide-y overflow-y-auto overscroll-contain rounded-lg border">
          {order.map((file, index) => (
            <li
              key={file.pathname}
              className="flex min-h-11 items-center gap-2 py-1 pr-1 pl-3"
            >
              <span className="text-muted-foreground w-5 shrink-0 text-sm tabular-nums">
                {index + 1}
              </span>
              <span aria-hidden className="size-5 shrink-0">
                <FileTypeIcon extension="pdf" />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">
                {file.name}
              </span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={t("moveUp", { name: file.name })}
                disabled={index === 0 || busy}
                onClick={(event) => move(index, -1, event.currentTarget)}
              >
                <ArrowUp aria-hidden className="size-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={t("moveDown", { name: file.name })}
                disabled={index === order.length - 1 || busy}
                onClick={(event) => move(index, 1, event.currentTarget)}
              >
                <ArrowDown aria-hidden className="size-4" />
              </Button>
            </li>
          ))}
        </ol>

        <div className="flex flex-col gap-2">
          <Label htmlFor="combine-pdf-name">{t("nameLabel")}</Label>
          <Input
            id="combine-pdf-name"
            value={name}
            maxLength={200}
            required
            autoComplete="off"
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        {problem ? (
          <p role="alert" className="text-semantic-destructive text-sm">
            {problem}
          </p>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onDone}
          >
            {t("cancel")}
          </Button>
          <Button type="submit" loading={busy} disabled={!name.trim()}>
            {t("download")}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
