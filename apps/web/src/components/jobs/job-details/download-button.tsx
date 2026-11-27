"use client";

import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useEventListener } from "@/hooks/effects/use-event-listener";
import useIsApplePlatform from "@/hooks/use-is-apple-platform";
import { cn } from "@/lib/utils";
import { markdownToSafeHtml } from "@/lib/utils/sanitizeMarkdown";

interface DownloadButtonProps {
  markdown: string;
  className?: string;
}

const FILE_NAME = "output";

// Constants for document export styling
const EXPORT_STYLES = {
  container:
    "font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; line-height: 1.6; color: black; background: white;",
  table: `
    table { border-collapse: collapse; }
    table, th, td { border: 1px solid currentColor; }
    td { padding: 0.5em; }
  `,
} as const;

/** The document the PDF export prints. Exported for its test. */
export async function markdownToExportHtml(markdownContent: string) {
  const html = await markdownToSafeHtml(markdownContent);

  return `
      <div style="${EXPORT_STYLES.container}">
        <style>${EXPORT_STYLES.table}</style>
        <div>${html}</div>
      </div>
    `;
}

async function fetchSvgAsPngDataUrl(
  svgPath: string,
  width: number,
  height: number,
) {
  const svgText = await fetch(svgPath).then((r) => r.text());
  const svgBlob = new Blob([svgText], {
    type: "image/svg+xml;charset=utf-8",
  });
  const url = URL.createObjectURL(svgBlob);
  try {
    const img = new Image();
    img.src = url;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = (e) => reject(e);
    });
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function triggerFileDownload(url: string, fileName: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
}

/** Saves markdown as a PDF or Word file named `fileName`; resolves false when the export fails. */
async function exportMarkdownFile(
  format: "pdf" | "docx",
  markdown: string,
  fileName: string,
): Promise<boolean> {
  try {
    const body =
      format === "pdf"
        ? { html: await markdownToExportHtml(markdown), fileName }
        : {
            markdown,
            fileName,
            logoPng: await fetchSvgAsPngDataUrl(
              "/images/logos/sokosumi-logo-black.svg",
              180,
              30,
            ),
            kanjiLogoPng: await fetchSvgAsPngDataUrl(
              "/images/kanji/sokosumi-logo-kanji-black.svg",
              20,
              40,
            ),
          };
    const res = await fetch(`/api/export/${format}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return false;
    const url = URL.createObjectURL(await res.blob());
    triggerFileDownload(url, `${fileName}.${format}`);
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}

const EXPORT_TOASTS = {
  pdf: { pending: "exportingPdf", failed: "exportPdfError" },
  docx: { pending: "exportingDocx", failed: "exportDocxError" },
} as const;

/** Exports markdown as PDF or Word, with a toast while it runs and one when it fails. */
export function useExportMarkdownFile(markdown: string, fileName: string) {
  const t = useTranslations("Components.Jobs.JobDetails.Output");
  return async (format: "pdf" | "docx") => {
    const id = toast.loading(t(EXPORT_TOASTS[format].pending));
    if (!(await exportMarkdownFile(format, markdown, fileName)))
      toast.error(t(EXPORT_TOASTS[format].failed));
    toast.dismiss(id);
  };
}

export default function DownloadButton({
  markdown,
  className,
}: DownloadButtonProps) {
  const t = useTranslations("Components.Jobs.JobDetails.Output");

  const isApplePlatform = useIsApplePlatform();
  const shortcutLabel = isApplePlatform ? "⇧⌘E" : "Shift+Ctrl+E";

  const handleDownloadMarkdown = useCallback(() => {
    const id = toast.loading(t("exportingMarkdown"));
    try {
      const url = URL.createObjectURL(
        new Blob([markdown], { type: "text/markdown" }),
      );
      triggerFileDownload(url, `${FILE_NAME}.md`);
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t("exportMarkdownError"));
    } finally {
      toast.dismiss(id);
    }
  }, [markdown, t]);

  const handleExport = useExportMarkdownFile(markdown, FILE_NAME);

  useEventListener("window", "keydown", (e) => {
    const isHostKey = isApplePlatform ? e.metaKey : e.ctrlKey;
    if (isHostKey && e.shiftKey && e.key.toLowerCase() === "e") {
      e.preventDefault();
      handleDownloadMarkdown();
    }
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("text-muted-foreground", className)}
          title={t("download")}
        >
          <Download className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onClick={handleDownloadMarkdown}>
          {t("exportAsMarkdown")}
          <DropdownMenuShortcut>{shortcutLabel}</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void handleExport("pdf")}>
          {t("exportAsPdf")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void handleExport("docx")}>
          {t("exportAsDocx")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
