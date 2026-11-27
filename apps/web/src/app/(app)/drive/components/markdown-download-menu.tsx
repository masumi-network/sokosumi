"use client";

import { ChevronDown, Download } from "lucide-react";
import { useTranslations } from "next-intl";

import { useExportMarkdownFile } from "@/components/jobs/job-details/download-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** The name of a file's PDF or Word copy: its own name without the extension. */
export function exportBaseName(displayName: string): string {
  return displayName.replace(/\.[^.]+$/, "");
}

/**
 * One Download control for a Markdown file in Files: the file itself, or a
 * PDF or Word copy made by the same export a Task result uses. The text is
 * read from `url` only when a copy is asked for.
 */
export function MarkdownDownloadMenu({
  url,
  downloadUrl,
  fileName,
  className,
  labelClassName,
}: {
  /** The file's bytes, inline, from the authorized content route. */
  url: string;
  /** The same bytes as an attachment. */
  downloadUrl: string;
  fileName: string;
  className?: string;
  /** Lets a compact header hide the label on a phone. */
  labelClassName?: string;
}) {
  const t = useTranslations("App.Drive.Files");
  const tExport = useTranslations("Components.Jobs.JobDetails.Output");
  const exportAs = useExportMarkdownFile(async () => {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Failed to read file");
    return response.text();
  }, exportBaseName(fileName));

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
        <DropdownMenuItem onSelect={() => void exportAs("pdf")}>
          {tExport("exportAsPdf")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void exportAs("docx")}>
          {tExport("exportAsDocx")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
