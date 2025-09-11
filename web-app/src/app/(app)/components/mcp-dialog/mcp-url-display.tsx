"use client";

import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

interface McpUrlDisplayProps {
  url: string;
}

export function McpUrlDisplay({ url }: McpUrlDisplayProps) {
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
    <div className="space-y-2">
      <label className="text-sm font-medium">{t("urlLabel")}</label>
      <div className="relative">
        <div className="bg-muted rounded-md p-3 pr-12 font-mono text-xs break-all">
          {url}
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="absolute top-2 right-2 h-8 w-8"
          onClick={handleCopy}
        >
          {copied ? (
            <Check className="h-4 w-4 text-green-500" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
