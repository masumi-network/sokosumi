"use client";

import type { ChatRoom, Coworker, Member } from "@sokosumi/core-client";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  addRoomMembersAction,
  type ChatComposeSokoBot,
} from "@/app/chat/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GuestInviteSection } from "./guest-invite-section";
import { ParticipantCheckboxes } from "./participant-checkboxes";

export interface AddRoomMembersDialogProps {
  room: ChatRoom;
  /** The organization roster, Coworkers and the reader's own Soko Bots. */
  members: Member[];
  coworkers: Coworker[];
  sokoBots: ChatComposeSokoBot[];
  membersLoadFailed: boolean;
  /** External channel: a second tab invites people from outside. */
  canInviteGuests: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Pick people, Coworkers and your own Soko Bots who are not in the channel yet. */
export function AddRoomMembersDialog({
  room,
  members,
  coworkers,
  sokoBots,
  membersLoadFailed,
  canInviteGuests,
  open,
  onOpenChange,
}: AddRoomMembersDialogProps) {
  const t = useTranslations("App.Channels.AddMembers");
  const form = (
    <AddRoomMembersForm
      room={room}
      members={members}
      coworkers={coworkers}
      sokoBots={sokoBots}
      membersLoadFailed={membersLoadFailed}
      onAdded={() => onOpenChange(false)}
    />
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="app-scrollbar max-h-[calc(100dvh-2rem)] min-w-0 overflow-x-hidden overflow-y-auto px-5 py-6 shadow-none sm:max-w-lg">
        <DialogHeader className="pr-6">
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("description", { name: room.name })}
          </DialogDescription>
        </DialogHeader>
        {canInviteGuests ? (
          <Tabs defaultValue="members" className="min-w-0 gap-4">
            <TabsList className="w-full">
              <TabsTrigger value="members">{t("membersTab")}</TabsTrigger>
              <TabsTrigger value="guests">{t("guestsTab")}</TabsTrigger>
            </TabsList>
            <TabsContent value="members" className="min-w-0">
              {form}
            </TabsContent>
            {/* Mounted only while its tab shows, so pending invites load on
                each visit rather than through an open-synced Effect. */}
            <TabsContent value="guests" className="min-w-0">
              <GuestInviteSection key={room.id} roomId={room.id} />
            </TabsContent>
          </Tabs>
        ) : (
          form
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Its own component inside the dialog content, which unmounts on close, so a
 * reopened dialog starts with nothing picked.
 */
function AddRoomMembersForm({
  room,
  members,
  coworkers,
  sokoBots,
  membersLoadFailed,
  onAdded,
}: Omit<
  AddRoomMembersDialogProps,
  "canInviteGuests" | "open" | "onOpenChange"
> & {
  onAdded: () => void;
}) {
  const t = useTranslations("App.Channels.AddMembers");
  const router = useRouter();
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [coworkerIds, setCoworkerIds] = useState<string[]>([]);
  const [sokoBotIds, setSokoBotIds] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();

  const inRoom = new Set([
    ...room.userMembers.map((member) => member.id),
    ...room.coworkerMembers.map((coworker) => coworker.id),
    ...room.sokoBotMembers.map((sokoBot) => sokoBot.id),
  ]);
  const availableMembers = members.filter(
    (member) => !inRoom.has(member.user.id),
  );
  const availableCoworkers = coworkers.filter(
    (coworker) => !inRoom.has(coworker.id),
  );
  const availableSokoBots = sokoBots.filter(
    (sokoBot) => !inRoom.has(sokoBot.id),
  );
  const nobodyToAdd =
    !membersLoadFailed &&
    availableMembers.length === 0 &&
    availableCoworkers.length === 0 &&
    availableSokoBots.length === 0;
  const count = memberIds.length + coworkerIds.length + sokoBotIds.length;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (count === 0) {
      toast.error(t("chooseSomeone"));
      return;
    }
    startTransition(async () => {
      const result = await addRoomMembersAction(room.id, {
        userIds: memberIds,
        coworkerIds,
        sokoBotIds,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success(t("success", { count }));
      onAdded();
      router.refresh();
    });
  }

  if (nobodyToAdd) {
    return (
      <p className="text-muted-foreground py-6 text-center text-sm">
        {t("nobodyToAdd")}
      </p>
    );
  }

  return (
    <form className="min-w-0 space-y-4" onSubmit={handleSubmit}>
      <ParticipantCheckboxes
        members={availableMembers}
        coworkers={availableCoworkers}
        sokoBots={availableSokoBots}
        memberIds={memberIds}
        coworkerIds={coworkerIds}
        sokoBotIds={sokoBotIds}
        onMemberIdsChange={setMemberIds}
        onCoworkerIdsChange={setCoworkerIds}
        onSokoBotIdsChange={setSokoBotIds}
        membersLoadFailed={membersLoadFailed}
      />
      <DialogFooter>
        <Button type="submit" variant="primary" loading={isPending}>
          {t("submit")}
        </Button>
      </DialogFooter>
    </form>
  );
}
