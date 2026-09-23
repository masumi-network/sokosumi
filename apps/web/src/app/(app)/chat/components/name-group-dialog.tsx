"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type FormEvent,
  type ReactElement,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import { updateRoomAction } from "@/app/chat/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ChatRoom } from "@/lib/clients/generated/core";

/** Same cap as a Channel name; Core enforces it too. */
const GROUP_NAME_MAX_LENGTH = 80;

/**
 * Names a group Direct. Only the one field: a group Direct has none of a
 * Channel's settings, and its members cannot change.
 */
export function NameGroupDialog({
  room,
  open,
  onOpenChange,
  children,
}: {
  room: ChatRoom;
  /** The room shell owns the flag, as it does for the Channel dialog. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Single element for DialogTrigger asChild; must accept merged props and ref. */
  children: ReactElement;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="px-5 py-6 shadow-none sm:max-w-md">
        {/* Content mounts on open, so the field starts from the current name. */}
        <NameGroupForm room={room} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function NameGroupForm({
  room,
  onDone,
}: {
  room: ChatRoom;
  onDone: () => void;
}) {
  const t = useTranslations("App.Channels.GroupName");
  const router = useRouter();
  const [groupName, setGroupName] = useState(room.groupName ?? "");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (groupName.trim() === (room.groupName ?? "")) {
      onDone();
      return;
    }
    startTransition(async () => {
      const result = await updateRoomAction(room.id, { groupName });
      if (!result.ok) {
        toast.error(t("saveFailed"));
        return;
      }
      onDone();
      router.refresh();
    });
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <DialogHeader className="pr-6">
        <DialogTitle>{t("dialogTitle")}</DialogTitle>
        <DialogDescription>{t("dialogDescription")}</DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="name-group-name">{t("label")}</Label>
        <Input
          id="name-group-name"
          value={groupName}
          onChange={(event) => setGroupName(event.target.value)}
          maxLength={GROUP_NAME_MAX_LENGTH}
          autoComplete="off"
        />
      </div>
      <DialogFooter>
        <Button type="submit" variant="primary" disabled={isPending}>
          {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          {t("save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
