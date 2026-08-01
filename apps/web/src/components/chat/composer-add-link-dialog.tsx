"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizeUrl } from "@/lib/utils/markdown-editor-utils";

interface ComposerAddLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialText?: string;
  initialUrl?: string;
  onSave: (text: string, url: string) => void;
}

export function ComposerAddLinkDialog({
  open,
  onOpenChange,
  initialText = "",
  initialUrl = "",
  onSave,
}: ComposerAddLinkDialogProps) {
  const t = useTranslations("App.Channels.AddLink");
  const textId = useId();
  const urlId = useId();
  const [text, setText] = useState(initialText);
  const [url, setUrl] = useState(initialUrl);

  useEffect(() => {
    if (!open) return;
    setText(initialText);
    setUrl(initialUrl);
  }, [initialText, initialUrl, open]);

  const normalizedUrl = normalizeUrl(url);
  const canSave = normalizedUrl !== null;

  function handleSave() {
    if (!normalizedUrl) return;
    onSave(text.trim() || initialText.trim(), normalizedUrl);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-1">
          <div className="grid gap-2">
            <Label htmlFor={textId}>{t("text")}</Label>
            <Input
              id={textId}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={t("textPlaceholder")}
              autoComplete="off"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={urlId}>{t("link")}</Label>
            <Input
              id={urlId}
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder={t("linkPlaceholder")}
              autoComplete="off"
              autoFocus
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t("cancel")}
          </Button>
          <Button type="button" disabled={!canSave} onClick={handleSave}>
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
