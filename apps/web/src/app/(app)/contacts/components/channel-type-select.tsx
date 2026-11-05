"use client";
import type { ContactChannelType } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { CHANNEL_ORDER } from "@/app/contacts/contacts-view";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChannelIcon } from "./contact-visuals";

export function ChannelTypeSelect({
  value,
  label,
  onChange,
}: {
  value: ContactChannelType;
  label: string;
  onChange: (type: ContactChannelType) => void;
}) {
  const t = useTranslations("App.Contacts.channelTypes");
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next as ContactChannelType)}
    >
      <SelectTrigger aria-label={label} className="w-36 shrink-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {CHANNEL_ORDER.map((type) => (
          <SelectItem key={type} value={type}>
            <ChannelIcon type={type} className="text-muted-foreground" />
            {t(type)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
