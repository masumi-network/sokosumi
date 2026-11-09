"use client";

import type { DataRoomTreeRow } from "@sokosumi/core-client";
import { ArrowDown, ArrowUp, File, Folder } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import {
  dataRoomRefusal,
  saveDataRoomOrder,
} from "@/lib/utils/data-room.client";
import type { FileStore } from "@/lib/utils/file-search.client";

function parentOf(path: string): string {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

/**
 * Moves one row before or after its neighbour in the same folder, carrying a
 * folder's contents with it. Returns the rows in their new order.
 */
export function moveRow(
  rows: readonly DataRoomTreeRow[],
  path: string,
  direction: -1 | 1,
): DataRoomTreeRow[] {
  const moved = rows.find((row) => row.path === path);
  if (!moved) return [...rows];
  // Folders always come before files, so a row only trades with its kind.
  const siblings = rows.filter(
    (row) => parentOf(row.path) === parentOf(path) && row.kind === moved.kind,
  );
  const index = siblings.findIndex((row) => row.path === path);
  const target = siblings[index + direction];
  if (!target) return [...rows];
  const block = (start: string) =>
    rows.filter(
      (row) => row.path === start || row.path.startsWith(`${start}/`),
    );
  const moving = block(path);
  const other = block(target.path);
  const rest = rows.filter(
    (row) => !moving.includes(row) && !other.includes(row),
  );
  const anchor = rows.indexOf(direction === -1 ? other[0] : moving[0]);
  const before = rest.filter((row) => rows.indexOf(row) < anchor);
  const after = rest.filter((row) => rows.indexOf(row) >= anchor);
  return [
    ...before,
    ...(direction === -1 ? [...moving, ...other] : [...other, ...moving]),
    ...after,
  ];
}

/** Positions from 1 within each folder, in the order shown. */
export function orderEntries(
  rows: readonly DataRoomTreeRow[],
): { path: string; position: number }[] {
  const counters = new Map<string, number>();
  return rows.map((row) => {
    const parent = parentOf(row.path);
    const position = (counters.get(parent) ?? 0) + 1;
    counters.set(parent, position);
    return { path: row.path, position };
  });
}

export function DataRoomContents({
  store,
  roomId,
  rows,
  onChanged,
}: {
  store: FileStore;
  roomId: string;
  rows: DataRoomTreeRow[];
  onChanged: () => void;
}) {
  const t = useTranslations("App.Drive.DataRoom.Contents");
  const [order, setOrder] = useState(rows);
  const [busy, setBusy] = useState(false);
  const changed = order.some((row, index) => row.path !== rows[index]?.path);

  if (rows.length === 0)
    return (
      <p className={cn(HOLDER_ITEM_CLASS, "text-muted-foreground p-4 text-sm")}>
        {t("empty")}
      </p>
    );

  return (
    <div className="grid gap-2">
      <p className="text-muted-foreground px-1 text-sm">{t("hint")}</p>
      <ul className={cn(HOLDER_ITEM_CLASS, "divide-border divide-y")}>
        {order.map((row) => {
          const Icon = row.kind === "folder" ? Folder : File;
          return (
            <li
              key={row.path}
              className="flex min-w-0 items-center gap-2 py-1.5 pe-2"
              style={{ paddingInlineStart: `${16 + row.depth * 16}px` }}
            >
              <Icon
                aria-hidden
                className="text-muted-foreground size-4 shrink-0"
              />
              <span className="min-w-0 flex-1 truncate text-sm">
                {row.name}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={t("moveUp", { name: row.name })}
                onClick={() =>
                  setOrder((current) => moveRow(current, row.path, -1))
                }
              >
                <ArrowUp aria-hidden className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={t("moveDown", { name: row.name })}
                onClick={() =>
                  setOrder((current) => moveRow(current, row.path, 1))
                }
              >
                <ArrowDown aria-hidden className="size-4" />
              </Button>
            </li>
          );
        })}
      </ul>
      <Button
        type="button"
        className="justify-self-start"
        loading={busy}
        disabled={!changed}
        onClick={async () => {
          setBusy(true);
          try {
            await saveDataRoomOrder({
              store,
              roomId,
              entries: orderEntries(order),
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
        {t("save")}
      </Button>
    </div>
  );
}
