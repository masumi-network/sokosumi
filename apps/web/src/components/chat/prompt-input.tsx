"use client";

import type { ChatStatus } from "ai";
import { Loader2Icon, SendIcon, SquareIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import type {
  ChangeEvent,
  ComponentProps,
  HTMLAttributes,
  KeyboardEventHandler,
} from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type PromptInputProps = HTMLAttributes<HTMLFormElement>;

export const PromptInput = ({ className, ...props }: PromptInputProps) => (
  <form
    className={cn(
      "bg-background w-full overflow-hidden rounded-xl border shadow-xs",
      className,
    )}
    {...props}
  />
);

export type PromptInputTextareaProps = ComponentProps<typeof Textarea> & {
  allowEnterToSubmitOnMobile?: boolean;
  maxHeight?: number;
  minHeight?: number;
  disableAutoResize?: boolean;
  resizeOnNewLinesOnly?: boolean;
};

function insertNewlineAtCursor(
  el: HTMLTextAreaElement,
  onChange?: (event: ChangeEvent<HTMLTextAreaElement>) => void,
) {
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? 0;
  const nextValue = `${el.value.slice(0, start)}\n${el.value.slice(end)}`;
  const nextCaret = start + 1;

  // Controlled inputs: React may ignore DOM `.value` writes, so pass the
  // next value on the synthetic event instead of reading it back from `el`.
  const valueTarget = { value: nextValue } as HTMLTextAreaElement;
  onChange?.({
    target: valueTarget,
    currentTarget: valueTarget,
  } as ChangeEvent<HTMLTextAreaElement>);

  // Restore caret after React commits the controlled update when possible.
  requestAnimationFrame(() => {
    if (el.value === nextValue) {
      el.setSelectionRange(nextCaret, nextCaret);
    }
  });
}

export const PromptInputTextarea = ({
  allowEnterToSubmitOnMobile = true,
  onChange,
  className,
  placeholder,
  minHeight: _minHeight = 48,
  maxHeight: _maxHeight = 164,
  disableAutoResize = false,
  resizeOnNewLinesOnly = false,
  ...props
}: PromptInputTextareaProps) => {
  const t = useTranslations("App.Chat.Chat");
  const resolvedPlaceholder = placeholder ?? t("promptPlaceholder");

  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if (e.key === "Enter") {
      if (e.nativeEvent.isComposing) {
        return;
      }

      // Shift+Enter: browser default inserts a newline.
      if (e.shiftKey) {
        return;
      }

      // Cmd/Ctrl+Enter: browsers do not insert a newline by default.
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        insertNewlineAtCursor(e.currentTarget, onChange);
        return;
      }

      if (
        !allowEnterToSubmitOnMobile &&
        typeof window !== "undefined" &&
        window.innerWidth < 768
      ) {
        e.preventDefault();
        return;
      }

      e.preventDefault();

      const form = e.currentTarget.form;
      const submitButton = form?.querySelector(
        'button[type="submit"]',
      ) as HTMLButtonElement | null;
      if (submitButton?.disabled) {
        return;
      }

      form?.requestSubmit();
    }
  };

  return (
    <Textarea
      className={cn(
        "w-full resize-none rounded-none border-none p-3 shadow-none ring-0 outline-hidden",
        disableAutoResize
          ? "field-sizing-fixed"
          : resizeOnNewLinesOnly
            ? "field-sizing-fixed"
            : "field-sizing-content max-h-[6lh]",
        "bg-transparent dark:bg-transparent",
        "focus-visible:ring-0",
        className,
      )}
      name="message"
      onChange={onChange}
      placeholder={resolvedPlaceholder}
      {...props}
      onKeyDown={handleKeyDown}
    />
  );
};

export type PromptInputToolbarProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputToolbar = ({
  className,
  ...props
}: PromptInputToolbarProps) => (
  <div
    className={cn("flex items-center justify-between p-1", className)}
    {...props}
  />
);

export type PromptInputToolsProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputTools = ({
  className,
  ...props
}: PromptInputToolsProps) => (
  <div
    className={cn(
      "flex items-center gap-1",
      "[&_button:first-child]:rounded-bl-xl",
      className,
    )}
    {...props}
  />
);

export type PromptInputSubmitProps = ComponentProps<typeof Button> & {
  status?: ChatStatus;
};

export const PromptInputSubmit = ({
  className,
  variant = "default",
  size = "icon",
  status,
  children,
  ...props
}: PromptInputSubmitProps) => {
  let Icon = <SendIcon className="size-4" />;

  if (status === "submitted") {
    Icon = <Loader2Icon className="size-4 animate-spin" />;
  } else if (status === "streaming") {
    Icon = <SquareIcon className="size-4" />;
  }

  return (
    <Button
      className={cn("gap-1.5 rounded-lg", className)}
      size={size}
      type="submit"
      variant={variant}
      {...props}
    >
      {children ?? Icon}
    </Button>
  );
};
