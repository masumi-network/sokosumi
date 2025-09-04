"use client";

import { Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CopyMarkdownProps {
  markdown: string;
  className?: string;
}

export default function CopyMarkdown({
  markdown,
  className,
}: CopyMarkdownProps) {
  const t = useTranslations("Components.Jobs.JobDetails.Output");

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      toast.success(t("copySuccess"));
    } catch {
      toast.error(t("copyError"));
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={copyToClipboard}
      className={cn("text-muted-foreground", className)}
      title={t("copy")}
    >
      <Copy className="h-4 w-4" />
    </Button>
  );
}
