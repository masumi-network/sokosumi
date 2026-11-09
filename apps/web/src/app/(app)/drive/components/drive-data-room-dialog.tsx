"use client";

import type { DataRoom } from "@sokosumi/core-client";
import { LockKeyhole } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  closeDataRoom,
  createDataRoom,
  dataRoomRefusal,
} from "@/lib/utils/data-room.client";
import type { FileStore } from "@/lib/utils/file-search.client";

export interface DriveDataRoomFolder {
  path: string;
  name: string;
  /** The room this folder is, or sits inside. */
  room: DataRoom | undefined;
}

/**
 * Turns the folder the reader stands in into a data room, or shows the room
 * it belongs to and lets the owner close it.
 */
export function DriveDataRoomDialog({
  store,
  folder,
  onOpenChange,
  onChanged,
}: {
  store: FileStore;
  folder: DriveDataRoomFolder | null;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const t = useTranslations("App.Drive.DataRoom");
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const room = folder?.room;
  const isRoot = room?.folderPath === folder?.path;

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await action();
      toast.success(done);
      onChanged();
      onOpenChange(false);
    } catch (error) {
      toast.error(dataRoomRefusal(error) ?? t("saveFailed"));
    } finally {
      setBusy(false);
      setConfirmClose(false);
    }
  }

  return (
    <>
      <Dialog open={folder !== null} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md" data-testid="data-room-dialog">
          <DialogHeader>
            <DialogTitle>
              {room
                ? t("roomTitle", {
                    name: room.folderPath.split("/").at(-1) ?? "",
                  })
                : t("makeTitle", { name: folder?.name ?? "" })}
            </DialogTitle>
            <DialogDescription>
              {room
                ? isRoot
                  ? t(`storage.${room.storage}`)
                  : t("insideRoom", { room: room.folderPath })
                : t("makeDescription")}
            </DialogDescription>
          </DialogHeader>

          {room ? (
            <div className="flex flex-wrap gap-2">
              {room.storage !== "moving_out" ? (
                <Button asChild>
                  <Link href={`/drive/data-rooms/${room.id}`}>
                    {t("manage")}
                  </Link>
                </Button>
              ) : null}
              {isRoot && room.storage !== "moving_out" ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setConfirmClose(true)}
                >
                  {t("close")}
                </Button>
              ) : null}
            </div>
          ) : (
            <Button
              type="button"
              loading={busy}
              onClick={() =>
                folder &&
                void run(
                  () => createDataRoom({ store, folderPath: folder.path }),
                  t("made"),
                )
              }
            >
              <LockKeyhole aria-hidden className="size-4" />
              {t("make")}
            </Button>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("closeTitle", { name: folder?.name ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("closeDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              loading={busy}
              onClick={(event) => {
                event.preventDefault();
                if (room)
                  void run(
                    () => closeDataRoom({ store, roomId: room.id }),
                    t("closed"),
                  );
              }}
            >
              {t("close")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
