"use client";

import { Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface OrganizationCopyableIdProps {
  value: string;
  buttonClassName?: string;
  codeClassName?: string;
  truncate?: boolean;
}

export default function OrganizationCopyableId({
  value,
  buttonClassName,
  codeClassName,
  truncate = true,
}: OrganizationCopyableIdProps) {
  const t = useTranslations("Components.HashValue");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t("copySuccess"));
    } catch {
      toast.error(t("copyError"));
    }
  };

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <code
        className={cn(
          "font-mono text-xs text-foreground/90 sm:text-sm",
          truncate && "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap",
          codeClassName,
        )}
      >
        {value}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => void handleCopy()}
        className={cn("text-muted-foreground size-8 shrink-0", buttonClassName)}
        title={t("copy")}
        aria-label={t("copy")}
      >
        <Copy className="size-4" />
      </Button>
    </div>
  );
}
