"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp } from "lucide-react";
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
import { FileTypeIcon } from "@/components/ui/file-icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  combineDrivePdfs,
  DriveCombinePdfError,
  type FileStore,
} from "@/lib/utils/file-search.client";
import { invalidateDrive } from "@/queries/drive";

export interface CombinePdfFile {
  pathname: string;
  name: string;
}

/**
 * Orders the selected PDFs and saves them as one new PDF beside the first.
 * The originals are never changed; a source Core cannot read saves nothing.
 */
export function DriveCombinePdfDialog({
  files,
  store,
  onOpenChange,
  onOpenFile,
}: {
  files: CombinePdfFile[] | null;
  store: FileStore;
  onOpenChange: (open: boolean) => void;
  onOpenFile: (file: { id: string; name: string }) => void;
}) {
  return (
    <Dialog open={files !== null} onOpenChange={onOpenChange}>
      {files ? (
        <CombineForm
          // A new selection starts from its own order and name.
          key={files.map((file) => file.pathname).join("\n")}
          initialFiles={files}
          store={store}
          onDone={() => onOpenChange(false)}
          onOpenFile={onOpenFile}
        />
      ) : null}
    </Dialog>
  );
}

function CombineForm({
  initialFiles,
  store,
  onDone,
  onOpenFile,
}: {
  initialFiles: CombinePdfFile[];
  store: FileStore;
  onDone: () => void;
  onOpenFile: (file: { id: string; name: string }) => void;
}) {
  const t = useTranslations("App.Drive.CombinePdf");
  const queryClient = useQueryClient();
  const [order, setOrder] = useState(initialFiles);
  const [name, setName] = useState(() => t("defaultName"));
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  function move(index: number, by: -1 | 1) {
    setOrder((current) => {
      const next = [...current];
      [next[index], next[index + by]] = [next[index + by], next[index]];
      return next;
    });
  }

  async function combine() {
    setSaving(true);
    setProblem(null);
    try {
      const saved = await combineDrivePdfs({
        pathnames: order.map((file) => file.pathname),
        filename: name.trim(),
      });
      void invalidateDrive(queryClient, store);
      toast.success(
        t("combined", { name: saved.name, pages: saved.pageCount }),
        {
          action: {
            label: t("open"),
            onClick: () =>
              onOpenFile({ id: saved.resourceId, name: saved.name }),
          },
        },
      );
      onDone();
    } catch (error) {
      setProblem(problemText(error));
    } finally {
      setSaving(false);
    }
  }

  function problemText(error: unknown): string {
    if (!(error instanceof DriveCombinePdfError)) return t("failed");
    const named = /"([^"]+)"/.exec(error.message)?.[1];
    if (error.status === 409) return t("duplicate", { name: named ?? name });
    if (error.status === 413) return t("tooLarge");
    if (error.status === 422 && named) return t("unreadable", { name: named });
    return t("failed");
  }

  return (
    <DialogContent className="max-h-[92dvh] overflow-y-auto overscroll-contain sm:max-w-lg">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void combine();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("title", { count: order.length })}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <ol className="flex flex-col divide-y rounded-lg border">
          {order.map((file, index) => (
            <li
              key={file.pathname}
              className="flex min-h-11 items-center gap-2 py-1 pr-1 pl-3"
            >
              <span className="text-muted-foreground w-5 shrink-0 text-sm tabular-nums">
                {index + 1}
              </span>
              <FileTypeIcon extension="pdf" />
              <span className="min-w-0 flex-1 truncate text-sm">
                {file.name}
              </span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={t("moveUp", { name: file.name })}
                disabled={index === 0 || saving}
                onClick={() => move(index, -1)}
              >
                <ArrowUp aria-hidden className="size-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={t("moveDown", { name: file.name })}
                disabled={index === order.length - 1 || saving}
                onClick={() => move(index, 1)}
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
            disabled={saving}
            onClick={onDone}
          >
            {t("cancel")}
          </Button>
          <Button type="submit" loading={saving} disabled={!name.trim()}>
            {t("combine")}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
