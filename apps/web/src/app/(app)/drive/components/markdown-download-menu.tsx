"use client";

import { ChevronDown, Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId } from "react";

import { useExportMarkdownFile } from "@/components/jobs/job-details/download-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  EXPORT_MAX_BYTES,
  ExportLimitError,
} from "@/lib/utils/export-operation";

/** The name of a file's PDF or Word copy: its own name without the extension. */
function exportBaseName(displayName: string): string {
  return displayName.replace(/\.[^.\s]+$/, "");
}

/** The file's text, refusing more than an export can send. */
async function readExportableText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error("Failed to read file");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    total += value.byteLength;
    if (total > EXPORT_MAX_BYTES) {
      void reader.cancel();
      throw new ExportLimitError("File exceeds export limit");
    }
    text += decoder.decode(value, { stream: true });
  }
}

/**
 * One Download control for a Markdown file in Files: the file itself, or a
 * PDF or Word copy made by the same export a Task result uses. The text is
 * read from `url` only when a copy is asked for. A file known to be over the
 * export limit keeps only the original, and says why.
 */
export function MarkdownDownloadMenu({
  url,
  downloadUrl,
  fileName,
  sizeBytes,
  className,
  labelClassName,
}: {
  /** The file's bytes, inline, from the authorized content route. */
  url: string;
  /** The same bytes as an attachment. */
  downloadUrl: string;
  fileName: string;
  /** The stored size, when the catalog knows it. */
  sizeBytes: number | null;
  className?: string;
  /** Lets a compact header hide the label on a phone. */
  labelClassName?: string;
}) {
  const t = useTranslations("App.Drive.Files");
  const tExport = useTranslations("Components.Jobs.JobDetails.Output");
  const tooLargeId = useId();
  const tooLarge = sizeBytes !== null && sizeBytes > EXPORT_MAX_BYTES;
  const exportAs = useExportMarkdownFile(
    () => readExportableText(url),
    exportBaseName(fileName),
  );
  const exportItem = {
    disabled: tooLarge,
    "aria-describedby": tooLarge ? tooLargeId : undefined,
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={className}
          aria-label={t("previewDownload")}
          title={t("previewDownload")}
        >
          <Download aria-hidden className="size-4" />
          <span className={labelClassName}>{t("previewDownload")}</span>
          <ChevronDown aria-hidden className={cn("size-4", labelClassName)} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <a href={downloadUrl} download={fileName}>
            {t("previewDownloadOriginal")}
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem {...exportItem} onSelect={() => void exportAs("pdf")}>
          {tExport("exportAsPdf")}
        </DropdownMenuItem>
        <DropdownMenuItem
          {...exportItem}
          onSelect={() => void exportAs("docx")}
        >
          {tExport("exportAsDocx")}
        </DropdownMenuItem>
        {tooLarge ? (
          <p
            id={tooLargeId}
            className="text-muted-foreground max-w-56 px-2 py-1.5 text-xs"
          >
            {t("previewExportTooLarge", {
              limit: EXPORT_MAX_BYTES / 1_000_000,
            })}
          </p>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
