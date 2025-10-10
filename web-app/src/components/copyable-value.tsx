"use client";

import { Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { KeyboardEvent, MouseEvent } from "react";
import { toast } from "sonner";

import { MiddleTruncate } from "@/components/middle-truncate";
import { Button } from "@/components/ui/button";

export interface CopyableValueProps {
  value: string | null;
  renderButtonAsChild?: boolean;
  shouldStopPropagation?: boolean;
}

export function CopyableValue({
  value,
  renderButtonAsChild = false,
  shouldStopPropagation = false,
}: CopyableValueProps) {
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

  const handleKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (shouldStopPropagation) event.stopPropagation();
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      void handleCopy();
    }
  };

  const handleButtonClick = (
    event: MouseEvent<HTMLButtonElement | HTMLSpanElement>,
  ) => {
    if (shouldStopPropagation) event.stopPropagation();
    void handleCopy();
  };

  return (
    <div className="flex items-center gap-2">
      <MiddleTruncate text={value} />
      <Button
        variant="ghost"
        size="icon"
        onClick={handleButtonClick}
        className="text-muted-foreground"
        title={t("copy")}
        aria-label={t("copy")}
        asChild={renderButtonAsChild}
        onKeyDown={renderButtonAsChild ? handleKeyDown : undefined}
      >
        {renderButtonAsChild ? (
          <span role="button" tabIndex={0} className="inline-flex size-9">
            <Copy className="size-4" />
          </span>
        ) : (
          <Copy className="size-4" />
        )}
      </Button>
    </div>
  );
}
