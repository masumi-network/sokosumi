"use client";

import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import type { KeyboardEvent, MouseEvent } from "react";

import { MiddleTruncate } from "@/components/middle-truncate";
import { Button } from "@/components/ui/button";
import { useClipboard } from "@/hooks/use-clipboard";
import { cn } from "@/lib/utils";

export interface CopyableValueProps {
  value: string | null;
  renderButtonAsChild?: boolean;
  shouldStopPropagation?: boolean;
  /** When true, swaps the copy icon for a checkmark briefly after a successful copy. */
  copiedFeedback?: boolean;
  /**
   * `middle-truncate` matches long hashes; `inline-code` uses a monospace line
   * with optional end-ellipsis (see `truncateInline`).
   */
  presentation?: "middle-truncate" | "inline-code";
  /** Only applies when `presentation` is `inline-code`. */
  truncateInline?: boolean;
  codeClassName?: string;
  buttonClassName?: string;
  containerClassName?: string;
}

export function CopyableValue({
  value,
  renderButtonAsChild = false,
  shouldStopPropagation = false,
  copiedFeedback = false,
  presentation = "middle-truncate",
  truncateInline = true,
  codeClassName,
  buttonClassName,
  containerClassName,
}: CopyableValueProps) {
  const t = useTranslations("Components.HashValue");
  const { copied, copy } = useClipboard({
    copySuccessMessage: t("copySuccess"),
    copyErrorMessage: t("copyError"),
  });

  if (!value) return <span>{"-"}</span>;

  const runCopy = () => {
    void copy(value);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (shouldStopPropagation) event.stopPropagation();
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      void runCopy();
    }
  };

  const handleButtonClick = (
    event: MouseEvent<HTMLButtonElement | HTMLSpanElement>,
  ) => {
    if (shouldStopPropagation) event.stopPropagation();
    void runCopy();
  };

  const showCheckIcon = copiedFeedback && copied;

  const valueNode =
    presentation === "middle-truncate" ? (
      <MiddleTruncate text={value} />
    ) : (
      <code
        className={cn(
          "font-mono text-xs text-foreground/90 sm:text-sm",
          truncateInline &&
            "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap",
          codeClassName,
        )}
      >
        {value}
      </code>
    );

  const icon = showCheckIcon ? (
    <Check className="text-semantic-success size-4" />
  ) : (
    <Copy className="size-4" />
  );

  return (
    <div
      className={cn(
        "flex min-w-0 items-center",
        presentation === "inline-code" && "gap-1.5",
        containerClassName,
      )}
    >
      {valueNode}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={handleButtonClick}
        className={cn(
          "text-muted-foreground shrink-0",
          presentation === "inline-code" && "size-8",
          buttonClassName,
        )}
        title={t("copy")}
        aria-label={t("copy")}
        asChild={renderButtonAsChild}
        onKeyDown={renderButtonAsChild ? handleKeyDown : undefined}
      >
        {renderButtonAsChild ? (
          <span role="button" tabIndex={0} className="inline-flex size-9">
            {icon}
          </span>
        ) : (
          icon
        )}
      </Button>
    </div>
  );
}
