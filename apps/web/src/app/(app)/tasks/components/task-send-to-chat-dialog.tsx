"use client";

import type { ChatRoom } from "@sokosumi/core-client";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { sendTaskToChatAction } from "@/app/chat/actions";
import { useRoomDisplayName } from "@/app/chat/components/use-room-display-name";
import { chatRoomHref } from "@/app/chat/utils/chat-route-base";
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
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";

const NOTE_MAX_LENGTH = 2000;

/** One send: what was sent where, under the id that makes a retry land once. */
interface SendAttempt {
  roomId: string;
  note: string;
  clientMessageId: string;
}

interface TaskSendToChatDialogProps {
  taskId: string;
  /** Rooms already narrowed by `chatRoomsForTask`. */
  rooms: ChatRoom[];
  currentUserId: string;
  onClose: () => void;
  /** Where focus goes on close; the dialog has no trigger of its own. */
  onCloseAutoFocus?: (event: Event) => void;
}

/**
 * Send a Task's link, with an optional note, into one chat room. Core builds
 * the message from the Task as it is at send time.
 *
 * The fields lock while a send runs. A failed send keeps its attempt: sending
 * the same room and note again retries under the same id, so a send whose
 * response was lost lands once. Changing either starts a new attempt.
 */
export function TaskSendToChatDialog({
  taskId,
  rooms,
  currentUserId,
  onClose,
  onCloseAutoFocus,
}: TaskSendToChatDialogProps) {
  const t = useTranslations("App.Tasks.Detail.actions.sendToChat");
  const router = useRouter();
  const roomName = useRoomDisplayName();
  const roomFieldId = useId();
  const noteFieldId = useId();
  const [roomId, setRoomId] = useState("");
  const [note, setNote] = useState("");
  const [failedAttempt, setFailedAttempt] = useState<SendAttempt | null>(null);
  const [isSending, startSending] = useTransition();

  const retrying =
    failedAttempt !== null &&
    failedAttempt.roomId === roomId &&
    failedAttempt.note === note;

  const handleSend = () => {
    if (!roomId || isSending) return;
    const attempt: SendAttempt =
      retrying && failedAttempt
        ? failedAttempt
        : { roomId, note, clientMessageId: crypto.randomUUID() };
    startSending(async () => {
      const result = await sendTaskToChatAction(taskId, attempt);
      if (!result.ok) {
        // A refusal cannot succeed on retry; anything else may have landed.
        setFailedAttempt(
          result.error.code === CommonErrorCode.UNAUTHORIZED ? null : attempt,
        );
        toast.error(result.error.message);
        return;
      }
      toast.success(t("success"), {
        action: {
          label: t("openChat"),
          onClick: () => router.push(chatRoomHref(attempt.roomId)),
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
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
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
              <Select
                value={roomId}
                onValueChange={setRoomId}
                disabled={isSending}
              >
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
                disabled={isSending}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
            {retrying ? (
              <p className="text-muted-foreground text-sm" role="status">
                {t("retryHint")}
              </p>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={isSending} onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button disabled={!roomId} loading={isSending} onClick={handleSend}>
            {retrying ? t("retry") : t("send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
