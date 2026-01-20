"use client";

import { Loader2, Send, Square } from "lucide-react";
import { useTranslations } from "next-intl";
import { KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  isLoading?: boolean;
  disabled?: boolean;
}

export default function ChatInput({
  value,
  onChange,
  onSubmit,
  onStop,
  isLoading = false,
  disabled = false,
}: ChatInputProps) {
  const t = useTranslations("App.Coworkers.Chat");

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter") {
      // Check if IME composition is in progress
      if (e.nativeEvent.isComposing) {
        return;
      }

      // Allow Shift+Enter for new line
      if (e.shiftKey) {
        return;
      }

      e.preventDefault();

      const form = e.currentTarget.form;
      const submitButton = form?.querySelector(
        'button[type="submit"]',
      ) as HTMLButtonElement | null;

      // Don't submit if button is disabled
      if (submitButton?.disabled) {
        return;
      }

      // Use form.requestSubmit() to trigger form submission
      form?.requestSubmit();
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (value.trim() && !isLoading && !disabled) {
      onSubmit();
    }
  };

  const isStreaming = isLoading;
  const canSubmit = !isLoading && value.trim() && !disabled;

  return (
    <div className="border-t bg-background p-4 w-full max-w-full overflow-hidden">
      <form
        onSubmit={handleSubmit}
        className="w-full overflow-hidden rounded-xl border bg-background shadow-sm"
      >
        <div className="flex items-center gap-2 min-w-0 w-full">
          <div className="flex-1 min-w-0 overflow-hidden">
            <Textarea
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("inputPlaceholder")}
              disabled={disabled || isLoading}
              name="message"
              className={cn(
                "w-full resize-none rounded-none border-none px-3 py-1.5 shadow-none outline-hidden ring-0",
                "field-sizing-content max-h-[6lh] min-h-[1lh]",
                "bg-transparent dark:bg-transparent",
                "focus-visible:ring-0",
                "overflow-y-auto overflow-x-hidden wrap-break-word break-all whitespace-pre-wrap",
                "[&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-muted [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-button]:hidden [&::-webkit-scrollbar-button]:h-0",
                "[scrollbar-width:thin] [scrollbar-color:transparent_transparent] hover:[scrollbar-color:rgb(161_161_170)_transparent] focus:[scrollbar-color:rgb(161_161_170)_transparent]",
              )}
              style={{
                wordWrap: "break-word",
                overflowWrap: "break-word",
                wordBreak: "break-word",
                lineHeight: "1.5",
              }}
            />
          </div>
          <div className="shrink-0 p-1">
            {isStreaming ? (
              <Button
                onClick={onStop}
                variant="default"
                size="icon"
                className="h-8 w-8 rounded-lg"
                type="button"
              >
                <Square className="size-4" />
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={!canSubmit}
                variant="primary"
                size="icon"
                className="h-8 w-8 rounded-lg"
              >
                {isLoading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
              </Button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
