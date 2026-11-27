"use client";

import type { ChatSticker } from "@sokosumi/core-client";
import { type LucideIcon, Plus, ScrollText, SmilePlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useRef, useState } from "react";
import { EmojiPickerPanel } from "@/components/chat/emoji-picker";
import { ROOM_COMPOSER_TOOL_BUTTON_CLASSNAME } from "@/components/chat/room-message-composer";
import { StickerPickerPanel } from "@/components/chat/sticker-picker";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { recordEmojiUse } from "@/hooks/use-frequently-used-emojis";

interface ComposerAction {
  label: string;
  icon: LucideIcon;
  select: () => void;
  disabled?: boolean;
  movesFocus?: boolean;
}

export function MobileRoomComposerTools({
  actions,
  skills,
}: {
  actions: ComposerAction[];
  skills?: {
    label: string;
    disabled: boolean;
    render: (pick: (select: () => void) => void) => ReactNode;
  };
}) {
  const t = useTranslations("App.Channels.Toolbar");
  const [open, setOpen] = useState(false);
  const [showSkills, setShowSkills] = useState(false);
  const movesFocusRef = useRef(false);

  function select(action: ComposerAction) {
    movesFocusRef.current = action.movesFocus ?? false;
    action.select();
    setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setShowSkills(false);
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={ROOM_COMPOSER_TOOL_BUTTON_CLASSNAME}
          aria-label={t("more")}
        >
          <Plus aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        collisionPadding={8}
        aria-label={showSkills ? skills?.label : t("more")}
        className="max-w-[calc(100vw-1rem)] max-h-(--radix-popover-content-available-height) overflow-y-auto overscroll-contain p-1"
        onCloseAutoFocus={(event) => {
          if (movesFocusRef.current) event.preventDefault();
          movesFocusRef.current = false;
        }}
      >
        {showSkills && skills ? (
          skills.render((pick) => {
            movesFocusRef.current = true;
            pick();
            setOpen(false);
          })
        ) : (
          <>
            {actions.map(({ icon: Icon, ...action }) => (
              <Button
                key={action.label}
                type="button"
                variant="ghost"
                className="w-full justify-start"
                disabled={action.disabled}
                onClick={() => select({ ...action, icon: Icon })}
              >
                <Icon aria-hidden />
                {action.label}
              </Button>
            ))}
            {skills ? (
              <Button
                type="button"
                variant="ghost"
                className="w-full justify-start"
                disabled={skills.disabled}
                onClick={() => setShowSkills(true)}
              >
                <ScrollText aria-hidden />
                {skills.label}
              </Button>
            ) : null}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function MobileRoomMediaPicker({
  stickerUserId,
  stickersDisabled,
  onEmoji,
  onSticker,
}: {
  stickerUserId?: string;
  stickersDisabled: boolean;
  onEmoji: (emoji: string) => void;
  onSticker: (sticker: ChatSticker) => void;
}) {
  const t = useTranslations("App.Channels");
  const [open, setOpen] = useState(false);
  const pickedRef = useRef(false);
  const label = t(stickerUserId ? "Toolbar.emojiAndStickers" : "Toolbar.emoji");

  function pickEmoji(emoji: string) {
    pickedRef.current = true;
    recordEmojiUse(emoji);
    onEmoji(emoji);
    setOpen(false);
  }

  function pickSticker(sticker: ChatSticker) {
    pickedRef.current = true;
    onSticker(sticker);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={ROOM_COMPOSER_TOOL_BUTTON_CLASSNAME}
          aria-label={label}
        >
          <SmilePlus aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        aria-label={label}
        align="end"
        side="top"
        collisionPadding={8}
        className="w-80 max-w-[calc(100vw-1rem)] max-h-(--radix-popover-content-available-height) overflow-y-auto overscroll-contain p-0"
        onCloseAutoFocus={(event) => {
          if (pickedRef.current) event.preventDefault();
          pickedRef.current = false;
        }}
      >
        {open &&
          (stickerUserId ? (
            <Tabs defaultValue="emoji" className="gap-0">
              <TabsList aria-label={label} className="m-2 mb-1 w-auto">
                <TabsTrigger value="emoji">{t("Toolbar.emoji")}</TabsTrigger>
                <TabsTrigger value="stickers" disabled={stickersDisabled}>
                  {t("Stickers.title")}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="emoji">
                <EmojiPickerPanel
                  onPick={pickEmoji}
                  autoFocus={false}
                  wrapCategories
                />
              </TabsContent>
              <TabsContent value="stickers" className="p-3">
                <StickerPickerPanel
                  userId={stickerUserId}
                  onPick={pickSticker}
                />
              </TabsContent>
            </Tabs>
          ) : (
            <EmojiPickerPanel
              onPick={pickEmoji}
              autoFocus={false}
              wrapCategories
            />
          ))}
      </PopoverContent>
    </Popover>
  );
}
