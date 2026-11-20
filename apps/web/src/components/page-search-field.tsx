"use client";

import { SearchIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ComponentProps, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import useIsApplePlatform from "@/hooks/use-is-apple-platform";
import { usePageSearchShortcut } from "@/hooks/use-page-search-shortcut";
import { cn } from "@/lib/utils";

export function PageSearchHint({ className }: { className?: string }) {
  const apple = useIsApplePlatform();
  const t = useTranslations("App.PageSearch");
  return (
    <Kbd
      aria-hidden="true"
      className={cn(
        "text-muted-foreground pointer-events-none hidden @min-[14rem]/page-search:inline-flex",
        className,
      )}
    >
      {apple ? "⌘F" : t("controlShortcut")}
    </Kbd>
  );
}

interface PageSearchFieldProps
  extends Omit<ComponentProps<"input">, "value" | "onChange" | "ref"> {
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  inHeader?: boolean;
  clearLabel?: string;
  inputClassName?: string;
  focusOnMount?: boolean;
}

export function PageSearchField({
  value,
  onValueChange,
  placeholder,
  inHeader,
  className,
  clearLabel,
  inputClassName,
  focusOnMount,
  onKeyDown,
  ...props
}: PageSearchFieldProps) {
  const t = useTranslations("App.PageSearch");
  const ref = useRef<HTMLInputElement>(null);
  usePageSearchShortcut(ref, { focusOnMount });
  function clear() {
    onValueChange("");
    ref.current?.focus();
  }
  return (
    <div
      className={cn(
        "@container/page-search relative w-full min-w-0 sm:max-w-sm",
        inHeader &&
          "min-w-[min(9rem,100%)] flex-1 basis-36 @2xl/page-toolbar:w-64 @2xl/page-toolbar:flex-none",
        className,
      )}
    >
      <SearchIcon
        aria-hidden="true"
        className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
      />
      <Input
        ref={ref}
        type="search"
        aria-label={placeholder}
        aria-keyshortcuts="Meta+F Control+F"
        className={cn(
          "bg-background ps-9 [&::-webkit-search-cancel-button]:hidden",
          value
            ? "pe-10 @min-[14rem]/page-search:pe-24"
            : "@min-[14rem]/page-search:pe-16",
          inHeader && "@2xl/page-toolbar:h-8",
          inputClassName,
        )}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (!event.defaultPrevented && event.key === "Escape" && value) {
            event.preventDefault();
            clear();
          }
        }}
        {...props}
      />
      {value && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="absolute end-0 top-1/2 size-10 -translate-y-1/2 md:end-1 md:size-8"
          aria-label={clearLabel ?? t("clear")}
          onClick={clear}
        >
          <XIcon aria-hidden="true" />
        </Button>
      )}
      <PageSearchHint
        className={cn(
          "absolute top-1/2 -translate-y-1/2",
          value ? "end-11" : "end-3",
        )}
      />
    </div>
  );
}
