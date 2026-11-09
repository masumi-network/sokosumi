"use client";

import type { DataRoom, DataRoomTreeRow } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { dataRoomRefusal, updateDataRoom } from "@/lib/utils/data-room.client";
import type { FileStore } from "@/lib/utils/file-search.client";
import { rowLabel } from "./data-room-activity";
import { DataRoomDateField } from "./data-room-date-field";

const NO_LOGO = "none";
const LOGO_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export function DataRoomSettingsPanel({
  store,
  room,
  rows,
  onChanged,
}: {
  store: FileStore;
  room: DataRoom;
  rows: DataRoomTreeRow[];
  onChanged: () => void;
}) {
  const t = useTranslations("App.Drive.DataRoom.Settings");
  const ids = {
    title: useId(),
    logo: useId(),
    domains: useId(),
    expires: useId(),
    download: useId(),
    watermark: useId(),
    notify: useId(),
  };
  const [title, setTitle] = useState(room.title ?? "");
  const [logoFileId, setLogoFileId] = useState(room.logoFileId ?? NO_LOGO);
  const [domains, setDomains] = useState(room.allowedDomains.join(", "));
  const [expiresAt, setExpiresAt] = useState(room.expiresAt);
  const [allowDownload, setAllowDownload] = useState(room.allowDownload);
  const [watermark, setWatermark] = useState(room.watermark);
  const [notify, setNotify] = useState(room.notifyOnFirstVisit);
  const [busy, setBusy] = useState(false);
  const images = rows.filter(
    (row) =>
      row.kind === "file" &&
      row.resourceId &&
      LOGO_TYPES.has(row.mimeType ?? ""),
  );

  return (
    <form
      className={cn(HOLDER_ITEM_CLASS, "grid gap-5 p-4")}
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        try {
          await updateDataRoom({
            store,
            roomId: room.id,
            settings: {
              title: title.trim() || null,
              logoFileId: logoFileId === NO_LOGO ? null : logoFileId,
              allowedDomains: domains
                .split(/[\s,;]+/)
                .map((domain) => domain.trim())
                .filter(Boolean),
              expiresAt: expiresAt ? new Date(expiresAt) : null,
              allowDownload,
              watermark,
              notifyOnFirstVisit: notify,
            },
          });
          toast.success(t("saved"));
          onChanged();
        } catch (error) {
          toast.error(dataRoomRefusal(error) ?? t("saveFailed"));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor={ids.title}>{t("titleLabel")}</Label>
        <Input
          id={ids.title}
          value={title}
          placeholder={room.folderPath.split("/").at(-1)}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={ids.logo}>{t("logoLabel")}</Label>
        <Select value={logoFileId} onValueChange={setLogoFileId}>
          <SelectTrigger id={ids.logo} className="w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_LOGO}>{t("noLogo")}</SelectItem>
            {images.map((row) => (
              <SelectItem key={row.resourceId} value={row.resourceId ?? ""}>
                {rowLabel(rows, row.path)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs">{t("logoHint")}</p>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={ids.domains}>{t("domainsLabel")}</Label>
        <Input
          id={ids.domains}
          value={domains}
          placeholder="fund.com"
          onChange={(event) => setDomains(event.target.value)}
        />
        <p className="text-muted-foreground text-xs">{t("domainsHint")}</p>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={ids.expires}>{t("expiresLabel")}</Label>
        <DataRoomDateField
          id={ids.expires}
          value={expiresAt}
          placeholder={t("noEnd")}
          clearLabel={t("clearEnd")}
          onChange={setExpiresAt}
        />
      </div>

      <SettingSwitch
        id={ids.download}
        label={t("downloadLabel")}
        hint={t("downloadHint")}
        checked={allowDownload}
        onChange={setAllowDownload}
      />
      <SettingSwitch
        id={ids.watermark}
        label={t("watermarkLabel")}
        hint={t("watermarkHint")}
        checked={watermark}
        onChange={setWatermark}
      />
      <SettingSwitch
        id={ids.notify}
        label={t("notifyLabel")}
        hint={t("notifyHint")}
        checked={notify}
        onChange={setNotify}
      />

      <Button type="submit" className="justify-self-start" loading={busy}>
        {t("save")}
      </Button>
    </form>
  );
}

function SettingSwitch({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="grid gap-0.5">
        <Label htmlFor={id}>{label}</Label>
        <p className="text-muted-foreground text-xs">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
