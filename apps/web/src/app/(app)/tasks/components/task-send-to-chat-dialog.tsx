"use client";

import type { ChatRoom } from "@sokosumi/core-client";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { sendRoomMessageAction } from "@/app/chat/actions";
import { useRoomDisplayName } from "@/app/chat/components/use-room-display-name";
import { chatRoomHref } from "@/app/chat/utils/chat-route-base";
import { taskChatMessage } from "@/app/tasks/utils/task-chat-share";
import type { TaskHrefInput } from "@/app/tasks/utils/task-href";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const NOTE_MAX_LENGTH = 2000;

interface TaskSendToChatDialogProps {
  task: TaskHrefInput;
  /** Rooms already narrowed by `chatRoomsForTask`. */
  rooms: ChatRoom[];
  currentUserId: string;
  onClose: () => void;
}

/**
 * Send a Task's link, with an optional note, into one chat room. Mounted per
 * open, so each open is one send: the client message id makes a retry after
 * a lost response land once, and a failed send keeps the note.
 */
export function TaskSendToChatDialog({
  task,
  rooms,
  currentUserId,
  onClose,
}: TaskSendToChatDialogProps) {
  const t = useTranslations("App.Tasks.Detail.actions.sendToChat");
  const router = useRouter();
  const roomName = useRoomDisplayName();
  const roomFieldId = useId();
  const noteFieldId = useId();
  const [roomId, setRoomId] = useState("");
  const [note, setNote] = useState("");
  const [clientMessageId] = useState(() => crypto.randomUUID());
  const [isSending, startSending] = useTransition();

  const handleSend = () => {
    if (!roomId || isSending) return;
    startSending(async () => {
      const result = await sendRoomMessageAction(
        roomId,
        taskChatMessage(task, note),
        [],
        { clientMessageId },
      );
      if (!result.ok) {
        toast.error(t("error"));
        return;
      }
      toast.success(t("success"), {
        action: {
          label: t("openChat"),
          onClick: () => router.push(chatRoomHref(roomId)),
        },
      });
      onClose();
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !isSending) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        {rooms.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noRooms")}</p>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor={roomFieldId}>{t("roomLabel")}</Label>
              <Select value={roomId} onValueChange={setRoomId}>
                <SelectTrigger id={roomFieldId} className="w-full">
                  <SelectValue placeholder={t("roomPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {rooms.map((room) => (
                    <SelectItem key={room.id} value={room.id}>
                      {room.kind === "channel" ? "# " : ""}
                      {roomName(room, currentUserId)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor={noteFieldId}>{t("noteLabel")}</Label>
              <Textarea
                id={noteFieldId}
                value={note}
                maxLength={NOTE_MAX_LENGTH}
                placeholder={t("notePlaceholder")}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={isSending} onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button disabled={!roomId} loading={isSending} onClick={handleSend}>
            {t("send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
