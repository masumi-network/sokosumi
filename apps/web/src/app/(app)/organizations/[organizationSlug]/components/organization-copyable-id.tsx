"use client";

import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface OrganizationCopyableIdProps {
  value: string;
  buttonClassName?: string;
  codeClassName?: string;
  truncate?: boolean;
}

const COPY_SUCCESS_TIMEOUT = 2000;

export default function OrganizationCopyableId({
  value,
  buttonClassName,
  codeClassName,
  truncate = true,
}: OrganizationCopyableIdProps) {
  const t = useTranslations("Components.HashValue");
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        setCopied(false);
        timeoutRef.current = null;
      }, COPY_SUCCESS_TIMEOUT);
      toast.success(t("copySuccess"));
    } catch {
      toast.error(t("copyError"));
    }
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

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
        {copied ? (
          <Check className="text-semantic-success size-4" />
        ) : (
          <Copy className="size-4" />
        )}
      </Button>
    </div>
  );
}
