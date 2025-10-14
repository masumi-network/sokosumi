"use client";

import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { sanitizeMarkdown } from "@/lib/utils/sanitizeMarkdown";

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

export default function DownloadButton({
  markdown,
  className,
}: DownloadButtonProps) {
  const t = useTranslations("Components.Jobs.JobDetails.Output");

  const isMac = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    const navUaPlatform = (
      navigator as unknown as { userAgentData?: { platform?: string } }
    ).userAgentData?.platform;
    const platform = navUaPlatform ?? navigator.platform ?? "";
    return /Mac|iPhone|iPad|iPod/i.test(platform);
  }, []);

  const shortcutLabel = useMemo(
    () => (isMac ? "⇧⌘E" : "Shift+Ctrl+E"),
    [isMac],
  );

  async function markdownToHtml(markdownContent: string) {
    const [{ marked }] = await Promise.all([
      import("marked") as Promise<typeof import("marked")>,
    ]);
    const sanitized = sanitizeMarkdown(markdownContent);
    const html = marked.parse(sanitized, { async: false }) as string;

    return `
      <div style="${EXPORT_STYLES.container}">
        <style>${EXPORT_STYLES.table}</style>
        <div>${html}</div>
      </div>
    `;
  }

  async function _fetchSvgAsPngDataUrl(
    svgPath: string,
    width = 100,
    height = 30,
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

  const handleDownloadPdf = async () => {
    const id = toast.loading(t("exportingPdf"));
    try {
      const html = await markdownToHtml(markdown);
      const res = await fetch("/api/export/pdf", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          html,
          fileName: FILE_NAME,
        }),
      });
      if (!res.ok) {
        toast.error(t("exportPdfError"));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      triggerFileDownload(url, `${FILE_NAME}.pdf`);
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t("exportPdfError"));
    } finally {
      toast.dismiss(id);
    }
  };

  const handleDownloadDocx = async () => {
    const id = toast.loading(t("exportingDocx"));
    try {
      const logoPng = await _fetchSvgAsPngDataUrl(
        "/images/logos/sokosumi-logo-black.svg",
        180,
        30,
      );

      const kanjiLogoPng = await _fetchSvgAsPngDataUrl(
        "/images/kanji/sokosumi-logo-kanji-black.svg",
        20,
        40,
      );

      const res = await fetch("/api/export/docx", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          markdown,
          fileName: FILE_NAME,
          logoPng,
          kanjiLogoPng,
        }),
      });
      if (!res.ok) {
        toast.error(t("exportDocxError"));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      triggerFileDownload(url, `${FILE_NAME}.docx`);
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t("exportDocxError"));
    } finally {
      toast.dismiss(id);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isHostKey = isMac ? e.metaKey : e.ctrlKey;
      if (isHostKey && e.shiftKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        handleDownloadMarkdown();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMac, handleDownloadMarkdown]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("text-muted-foreground", className)}
          title={t("download")}
        >
          <Download className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onClick={handleDownloadMarkdown}>
          {t("exportAsMarkdown")}
          <DropdownMenuShortcut>{shortcutLabel}</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleDownloadPdf}>
          {t("exportAsPdf")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleDownloadDocx}>
          {t("exportAsDocx")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
