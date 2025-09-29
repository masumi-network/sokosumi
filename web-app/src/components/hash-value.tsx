"use client";

import { Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { MiddleTruncate } from "@/components/middle-truncate";
import { Button } from "@/components/ui/button";

export interface HashValueProps {
  value: string | null;
}

export function HashValue({ value }: HashValueProps) {
  const t = useTranslations("Components.HashValue");
  if (!value) return <span>{"-"}</span>;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t("copySuccess"));
    } catch {
      toast.error(t("copyError"));
    }
  };

  return (
    <div className="flex items-center gap-2">
      <MiddleTruncate text={value} />
      <Button
        variant="ghost"
        size="icon"
        onClick={handleCopy}
        className="text-muted-foreground"
        title={t("copy")}
        aria-label={t("copy")}
      >
        <Copy className="h-4 w-4" />
      </Button>
    </div>
  );
}
