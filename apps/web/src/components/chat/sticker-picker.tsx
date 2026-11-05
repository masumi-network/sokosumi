"use client";

import type { ChatSticker } from "@sokosumi/core-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sticker, Upload } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  getSavedChatStickers,
  saveChatSticker,
} from "@/lib/services/chat-sticker.browser";

interface StickerPickerProps {
  userId: string;
  onPick: (sticker: ChatSticker) => void;
  triggerClassName?: string;
  disabled?: boolean;
}

export function StickerPicker({
  userId,
  onPick,
  triggerClassName,
  disabled,
}: StickerPickerProps) {
  const t = useTranslations("App.Channels.Stickers");
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={triggerClassName}
          aria-label={t("title")}
          title={t("title")}
          disabled={disabled}
        >
          <Sticker className="size-4" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 max-w-[calc(100vw-2rem)] p-3"
        aria-label={t("title")}
      >
        {open ? (
          <StickerPickerPanel
            userId={userId}
            onPick={(sticker) => {
              onPick(sticker);
              setOpen(false);
            }}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function StickerPickerPanel({
  userId,
  onPick,
}: Pick<StickerPickerProps, "userId" | "onPick">) {
  const t = useTranslations("App.Channels.Stickers");
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const queryKey = ["chat-stickers", userId];
  const {
    data = [],
    isPending,
    isError,
    refetch,
  } = useQuery({ queryKey, queryFn: getSavedChatStickers });
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUpload(file: File | undefined) {
    if (!file || uploading) return;
    setError(null);
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size === 0 ||
      file.size > 2 * 1024 * 1024
    ) {
      setError(t("invalid"));
      return;
    }
    setUploading(true);
    try {
      const sticker = await saveChatSticker(file);
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData<ChatSticker[]>(queryKey, (current = []) => [
        ...current,
        sticker,
      ]);
    } catch {
      setError(t("uploadFailed"));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">{t("title")}</p>
        <p className="text-muted-foreground text-xs" id="sticker-upload-hint">
          {t("hint")}
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        aria-label={t("upload")}
        aria-describedby="sticker-upload-hint"
        onChange={(event) => void handleUpload(event.currentTarget.files?.[0])}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        loading={uploading}
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="size-4" aria-hidden />
        {t("upload")}
      </Button>
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      {isPending ? (
        <p role="status" className="text-muted-foreground text-sm">
          {t("loading")}
        </p>
      ) : isError ? (
        <div role="alert">
          <p className="text-sm">{t("loadFailed")}</p>
          <Button type="button" variant="ghost" onClick={() => void refetch()}>
            {t("retry")}
          </Button>
        </div>
      ) : data.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <ul
          className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto overscroll-contain"
          aria-label={t("collection")}
        >
          {data.map((sticker) => (
            <li key={sticker.url}>
              <Button
                type="button"
                variant="ghost"
                className="h-20 w-full p-2"
                aria-label={t("select", { name: sticker.name })}
                onClick={() => onPick(sticker)}
              >
                <Image
                  src={sticker.url}
                  alt={sticker.name}
                  width={64}
                  height={64}
                  unoptimized
                  className="size-16 object-contain"
                />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
