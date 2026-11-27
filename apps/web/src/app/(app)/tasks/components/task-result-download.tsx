"use client";

import { Copy, Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { useExportMarkdownFile } from "@/components/jobs/job-details/download-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { markdownToSafeHtml } from "@/lib/utils/sanitizeMarkdown";

/**
 * Puts the result on the clipboard as rendered HTML, so Gmail, Docs or Word keep headings, links, lists
 * and tables, with the Markdown as plain text for plain editors. Resolves false where the browser can
 * only copy text. The HTML goes in as a promise so Safari still counts the copy as part of the click.
 */
async function copyResult(markdown: string): Promise<boolean> {
  if (typeof ClipboardItem === "undefined") {
    await navigator.clipboard.writeText(markdown);
    return false;
  }
  await navigator.clipboard.write([
    new ClipboardItem({
      "text/html": markdownToSafeHtml(markdown).then(
        (html) => new Blob([html], { type: "text/html" }),
      ),
      "text/plain": new Blob([markdown], { type: "text/plain" }),
    }),
  ]);
  return true;
}

/** Copies a Task's result with its formatting, or downloads it as a PDF or Word file named after the Task, to hand on outside Sokosumi. */
export function TaskResultDownload({
  markdown,
  fileName,
}: {
  markdown: string;
  fileName: string;
}) {
  const t = useTranslations("Components.Jobs.JobDetails.Output");
  const exportAs = useExportMarkdownFile(markdown, fileName);
  const copy = async () => {
    try {
      toast.success(
        t(
          (await copyResult(markdown)) ? "copyFormattedSuccess" : "copySuccess",
        ),
      );
    } catch {
      toast.error(t("copyError"));
    }
  };
  return (
    <div className="flex justify-end gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-10 md:size-8"
            aria-label={t("copy")}
            onClick={copy}
          >
            <Copy className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("copy")}</TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-10 md:size-8"
                aria-label={t("download")}
              >
                <Download className="size-4" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{t("download")}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => void exportAs("pdf")}>
            {t("exportAsPdf")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void exportAs("docx")}>
            {t("exportAsDocx")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
