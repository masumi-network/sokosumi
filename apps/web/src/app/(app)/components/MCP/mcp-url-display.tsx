"use client";

import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface McpUrlDisplayProps {
  url: string;
  className?: string;
}

export function McpUrlDisplay({ url, className }: McpUrlDisplayProps) {
  const t = useTranslations("App.MCP");
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
      toast.error(t("copyError"));
    }
  };

  return (
    <div
      className={cn(
        "bg-background flex items-center gap-3 rounded-lg border py-1 pr-1 pl-3",
        className,
      )}
    >
      <span className="min-w-0 flex-1 font-mono text-sm break-all">{url}</span>
      <Button
        size="icon"
        variant="ghost"
        className="size-10 shrink-0 md:size-8"
        onClick={handleCopy}
        aria-label={t("copyUrl")}
      >
        {copied ? (
          <Check className="check-pop text-foreground size-4" />
        ) : (
          <Copy className="size-4" />
        )}
      </Button>
    </div>
  );
}
