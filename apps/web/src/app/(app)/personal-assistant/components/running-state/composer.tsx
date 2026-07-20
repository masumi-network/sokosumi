"use client";

import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import React, { type FormEvent, useEffect, useState } from "react";

import { ArrowUpIcon, StopIcon } from "@/components/chat/icons";
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
} from "@/components/chat/prompt-input";
import { Button } from "@/components/ui/button";
import {
  FileUpload,
  FileUploadDropzone,
  FileUploadItem,
  FileUploadItemDelete,
  FileUploadItemMetadata,
  FileUploadItemPreview,
  FileUploadList,
  FileUploadTrigger,
} from "@/components/ui/file-upload";
import { orderedMessageList } from "@/lib/intl/ordered-message-list";
import { cn } from "@/lib/utils";

export interface ComposerProps {
  ref: React.RefObject<HTMLTextAreaElement | null>;
  input: string;
  setInput: (v: string) => void;
  files: File[];
  setFiles: (files: File[]) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  isReplying: boolean;
  /** When true (e.g. orchestrator is mid-apply), block the user from sending. */
  disabled?: boolean;
  onStop: () => void;
  placeholder: string;
  sendLabel: string;
  stopLabel: string;
  attachLabel: string;
}

/**
 * Rotating hints shown in the composer placeholder when the user hasn't
 * typed anything. Gives first-session users concrete things to try without
 * adding chrome below the welcome.
 */
const ROTATE_INTERVAL_MS = 4_500;

export function Composer({
  ref,
  input,
  setInput,
  files,
  setFiles,
  onSubmit,
  isReplying,
  disabled = false,
  onStop,
  placeholder,
  sendLabel,
  stopLabel,
  attachLabel,
}: ComposerProps) {
  const t = useTranslations("App.Hermes.Running");
  const rotatingHints = orderedMessageList(
    t.raw("rotatingHints") as Record<string, string>,
  );
  const canSend =
    (input.trim().length > 0 || files.length > 0) && !isReplying && !disabled;
  const status = isReplying ? "streaming" : "ready";

  // Rotate hint placeholders while the composer is empty + idle. As soon as
  // the user types or starts a turn, freeze on the default placeholder so we
  // don't visually fight the typing experience.
  const [hintIdx, setHintIdx] = useState(0);
  useEffect(() => {
    if (input.length > 0 || isReplying) return;
    const id = window.setInterval(
      () => setHintIdx((i) => (i + 1) % rotatingHints.length),
      ROTATE_INTERVAL_MS,
    );
    return () => window.clearInterval(id);
  }, [input.length, isReplying, rotatingHints.length]);
  const dynamicPlaceholder =
    input.length > 0 || isReplying
      ? placeholder
      : (rotatingHints[hintIdx] ?? placeholder);

  return (
    <FileUpload
      value={files}
      onValueChange={setFiles}
      multiple
      maxSize={20 * 1024 * 1024}
      className="w-full"
      label={attachLabel}
    >
      {/* Same animated gradient border + soft glow as the /chat composer
          (`.chat-input-border-anchor` in globals.css) so the two chat
          surfaces read as one product. */}
      <div
        className={cn(
          "chat-input-border-anchor",
          // z-10 lifts the glow above the scroll-fade overlay (z-5) — without
          // it the fade's opaque bottom edge masks the halo into a hard line.
          "relative z-10 rounded-xl",
          "shadow-[0_0_16px_0] shadow-primary/15",
          "focus-within:shadow-[0_0_24px_2px] focus-within:shadow-primary/30",
          "transition-shadow duration-300",
          disabled && "pointer-events-none opacity-60",
        )}
      >
        <PromptInput
          onSubmit={onSubmit}
          className="bg-background relative z-10 rounded-[calc(var(--radius-xl)-1.5px)] border-0 shadow-none transition-all duration-200"
        >
          <FileUploadDropzone
            className="data-dragging:bg-accent/20 w-full items-stretch justify-start border-0 p-0 hover:bg-transparent"
            onClick={(event) => event.preventDefault()}
          >
            <PromptInputTextarea
              ref={ref}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                disabled ? t("composerDisabledPlaceholder") : dynamicPlaceholder
              }
              disableAutoResize
              maxHeight={200}
              minHeight={44}
              autoFocus
              disabled={disabled}
              className="placeholder:text-muted-foreground scrollbar-none grow resize-none border-0! bg-transparent p-4 text-base ring-0 outline-none [-ms-overflow-style:none] focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none [&::-webkit-scrollbar]:hidden"
            />
          </FileUploadDropzone>

          <FileUploadList orientation="horizontal" className="gap-2 px-3 pb-1">
            {files.map((file) => (
              <FileUploadItem
                key={`${file.name}-${file.lastModified}`}
                value={file}
                className="bg-muted/40 border-border/60 flex max-w-56 items-center gap-2 rounded-md border px-2 py-1.5"
              >
                <FileUploadItemPreview className="size-7 shrink-0 rounded" />
                <FileUploadItemMetadata className="min-w-0 flex-1 text-xs" />
                <FileUploadItemDelete asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-foreground size-6 shrink-0 rounded-full"
                    aria-label={t("removeFile")}
                  >
                    <X className="size-3.5" aria-hidden />
                  </Button>
                </FileUploadItemDelete>
              </FileUploadItem>
            ))}
          </FileUploadList>

          <PromptInputToolbar className="border-t-0 p-3">
            <PromptInputTools className="flex-wrap gap-1 sm:gap-1.5">
              <FileUploadTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="size-8 rounded-full! p-0"
                  title={attachLabel}
                  aria-label={attachLabel}
                >
                  <Plus className="size-3.5" />
                </Button>
              </FileUploadTrigger>
            </PromptInputTools>

            {isReplying ? (
              <Button
                type="button"
                variant="default"
                size="icon"
                onClick={onStop}
                aria-label={stopLabel}
                className="size-8 rounded-full"
              >
                <StopIcon size={14} />
              </Button>
            ) : (
              <PromptInputSubmit
                className="size-8 rounded-full transition-colors duration-200"
                disabled={!canSend}
                status={status}
                aria-label={sendLabel}
              >
                <ArrowUpIcon size={14} />
              </PromptInputSubmit>
            )}
          </PromptInputToolbar>
        </PromptInput>
      </div>
    </FileUpload>
  );
}
