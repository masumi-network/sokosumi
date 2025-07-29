"use client";

import { Download } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface DownloadMarkdownProps {
  markdown: string;
  className?: string;
}

export default function DownloadMarkdown({
  markdown,
  className,
}: DownloadMarkdownProps) {
  const downloadFile = () => {
    const url = URL.createObjectURL(
      new Blob([markdown], { type: "text/markdown" }),
    );
    Object.assign(document.createElement("a"), {
      href: url,
      download: "output.md",
    }).click();
    URL.revokeObjectURL(url);
  };

  const t = useTranslations("App.Agents.Jobs.JobDetails.Output");

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={downloadFile}
      className={cn("text-muted-foreground", className)}
      title={t("download")}
    >
      <Download className="h-4 w-4" />
    </Button>
  );
}
