"use client";
import type { ChatRoom } from "@sokosumi/core-client";
import { Ellipsis, RotateCcw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteRoomAction, restoreRoomAction } from "@/app/chat/actions";
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
import { Collapsible } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarRowSlot,
} from "@/components/ui/sidebar";
import { SIDEBAR_ROW_CLASS } from "@/components/ui/sidebar-classes";
import { SidebarSectionContent } from "@/components/ui/sidebar-section";
import { cn } from "@/lib/utils";
import { ChannelKindGlyph } from "./channel-discoverability-icon";
import { ChatSidebarSectionHeader } from "./chat-sidebar-section-header";
import type { useOrganizationChatRooms } from "./use-organization-chat-rooms";

/** Same absolute slot as live room rows so archived height matches Channels/DMs. */
const ARCHIVED_TRAILING_CONTROL_CLASS =
  "absolute top-1/2 right-1 z-10 flex size-8 -translate-y-1/2 items-center justify-center after:absolute after:-inset-1.5 md:size-7 md:after:-inset-0.5";

export function useArchivedRoomActions({
  setArchivedRows,
  upsertRoomToTop,
}: Pick<
  ReturnType<typeof useOrganizationChatRooms>,
  "setArchivedRows" | "upsertRoomToTop"
>) {
  const tActions = useTranslations("App.Channels.Actions");
  const router = useRouter();
  const [restoringRoomId, setRestoringRoomId] = useState<string | null>(null);
  const [deletingRoomId, setDeletingRoomId] = useState<string | null>(null);
  const [pendingDeleteRoom, setPendingDeleteRoom] = useState<ChatRoom | null>(
    null,
  );
  const [_isRestoring, startRestoreTransition] = useTransition();
  const [_isDeleting, startDeleteTransition] = useTransition();
  function handleRestoreRoom(room: ChatRoom) {
    if (restoringRoomId || deletingRoomId) {
      return;
    }
    setRestoringRoomId(room.id);
    startRestoreTransition(async () => {
      const result = await restoreRoomAction(room.id);
      setRestoringRoomId(null);
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success(tActions("restoreSuccess", { name: room.name }));
      upsertRoomToTop(result.value);
      router.push(`/chat/rooms/${result.value.id}`);
    });
  }

  function handleConfirmDeleteRoom() {
    const room = pendingDeleteRoom;
    if (!room || restoringRoomId || deletingRoomId) {
      return;
    }
    setDeletingRoomId(room.id);
    startDeleteTransition(async () => {
      const result = await deleteRoomAction(room.id);
      setDeletingRoomId(null);
      setPendingDeleteRoom(null);
      if (!result.ok) {
        toast.error(result.error.message || tActions("deleteError"));
        return;
      }
      toast.success(tActions("deleteSuccess", { name: room.name }));
      setArchivedRows((current) => current.filter((row) => row.id !== room.id));
    });
  }

  return {
    restoringRoomId,
    deletingRoomId,
    pendingDeleteRoom,
    setPendingDeleteRoom,
    handleRestoreRoom,
    handleConfirmDeleteRoom,
  };
}

export function ArchivedRoomsSection({
  rooms,
  visible,
  open,
  onOpenChange,
  isOrgOwnerOrAdmin,
  actions,
}: {
  rooms: readonly ChatRoom[];
  visible: boolean;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  isOrgOwnerOrAdmin: boolean;
  actions: ReturnType<typeof useArchivedRoomActions>;
}) {
  const t = useTranslations("App.Channels");
  const tActions = useTranslations("App.Channels.Actions");
  const {
    restoringRoomId,
    deletingRoomId,
    pendingDeleteRoom,
    setPendingDeleteRoom,
    handleRestoreRoom,
    handleConfirmDeleteRoom,
  } = actions;
  return (
    <>
      {visible ? (
        <Collapsible open={open} onOpenChange={onOpenChange}>
          <ChatSidebarSectionHeader isOpen={open}>
            {t("archivedChannels")}
          </ChatSidebarSectionHeader>
          <SidebarSectionContent>
            <SidebarMenu className="gap-0">
              {rooms.map((room) => {
                const isRestoring = restoringRoomId === room.id;
                const isDeleting = deletingRoomId === room.id;
                const actionBusy =
                  restoringRoomId !== null || deletingRoomId !== null;
                const showOverflowMenu = isOrgOwnerOrAdmin;
                return (
                  <SidebarMenuItem
                    key={room.id}
                    className="group/room-row relative"
                  >
                    <div
                      className={cn(
                        SIDEBAR_ROW_CLASS,
                        "text-tertiary-foreground dark:text-muted-foreground",
                      )}
                    >
                      <SidebarRowSlot>
                        <ChannelKindGlyph
                          className="opacity-60"
                          discoverability={room.discoverability}
                        />
                      </SidebarRowSlot>
                      <span className="min-w-0 flex-1 truncate">
                        {room.name}
                      </span>
                      <span className="size-8 shrink-0 md:size-7" aria-hidden />
                    </div>
                    {showOverflowMenu ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={actionBusy}
                            className={cn(
                              ARCHIVED_TRAILING_CONTROL_CLASS,
                              "text-muted-foreground",
                              isRestoring || isDeleting
                                ? "opacity-100"
                                : "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within/room-row:opacity-100 [@media(hover:hover)]:group-hover/room-row:opacity-100 data-[state=open]:opacity-100",
                            )}
                            aria-label={tActions("roomMenu", {
                              name: room.name,
                            })}
                          >
                            <Ellipsis
                              className={cn(
                                "size-5 md:size-4",
                                (isRestoring || isDeleting) && "animate-pulse",
                              )}
                              aria-hidden
                            />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem
                            disabled={actionBusy}
                            onSelect={() => handleRestoreRoom(room)}
                          >
                            <RotateCcw className="size-4" aria-hidden />
                            {tActions("restore")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={actionBusy}
                            variant="destructive"
                            onSelect={() => setPendingDeleteRoom(room)}
                          >
                            <Trash2 className="size-4" aria-hidden />
                            {tActions("delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={cn(
                          ARCHIVED_TRAILING_CONTROL_CLASS,
                          "text-muted-foreground",
                          isRestoring
                            ? "opacity-100"
                            : "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within/room-row:opacity-100 [@media(hover:hover)]:group-hover/room-row:opacity-100",
                        )}
                        disabled={actionBusy}
                        loading={isRestoring}
                        onClick={() => handleRestoreRoom(room)}
                        aria-label={`${tActions("restore")} ${room.name}`}
                      >
                        <RotateCcw className="size-3.5" aria-hidden />
                      </Button>
                    )}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarSectionContent>
        </Collapsible>
      ) : null}

      <AlertDialog
        open={pendingDeleteRoom !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && deletingRoomId === null) {
            setPendingDeleteRoom(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingDeleteRoom
                ? tActions("deleteConfirmTitle", {
                    name: pendingDeleteRoom.name,
                  })
                : null}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeleteRoom
                ? tActions("deleteConfirmDescription", {
                    name: pendingDeleteRoom.name,
                  })
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingRoomId !== null}>
              {tActions("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              loading={deletingRoomId !== null}
              onClick={(event) => {
                event.preventDefault();
                handleConfirmDeleteRoom();
              }}
            >
              {tActions("deleteConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
