"use client";

import { ListTodo, MessageSquare } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ChatComposeKind } from "@/app/chat/utils/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

interface ComposeKindSelectorProps {
  value: ChatComposeKind;
  onValueChange: (value: string) => void;
}

export function ComposeKindSelector({
  value,
  onValueChange,
}: ComposeKindSelectorProps) {
  const t = useTranslations("App.Chat.Chat");

  return (
    <>
      <div className="shrink-0 sm:hidden">
        <Select value={value} onValueChange={onValueChange}>
          <SelectTrigger
            size="sm"
            aria-label={t("composeMode")}
            className="hover:bg-muted h-9 max-w-[min(11rem,42vw)] border-none bg-muted/50 px-2.5 shadow-none"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start" side="top">
            <SelectItem value="chat">
              <MessageSquare className="size-3.5 shrink-0" aria-hidden />
              {t("composeChat")}
            </SelectItem>
            <SelectItem value="task">
              <ListTodo className="size-3.5 shrink-0" aria-hidden />
              {t("composeTask")}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={onValueChange}
        variant="default"
        size="sm"
        className="border-0! bg-muted/50 hidden h-9 rounded-full! p-1 sm:flex"
        aria-label={t("composeMode")}
      >
        <ToggleGroupItem
          value="chat"
          aria-label={t("composeChat")}
          className="data-[state=on]:bg-background flex items-center gap-1.5 rounded-full! px-3"
        >
          <MessageSquare className="size-3.5 shrink-0" aria-hidden />
          {t("composeChat")}
        </ToggleGroupItem>
        <ToggleGroupItem
          value="task"
          aria-label={t("composeTask")}
          className="data-[state=on]:bg-background flex items-center gap-1.5 rounded-full! px-3"
        >
          <ListTodo className="size-3.5 shrink-0" aria-hidden />
          {t("composeTask")}
        </ToggleGroupItem>
      </ToggleGroup>
    </>
  );
}
