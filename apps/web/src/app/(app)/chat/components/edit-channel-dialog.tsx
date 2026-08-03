"use client";

import {
  Archive as ArchiveIcon,
  Loader2,
  LogOut,
  Settings2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  archiveRoomAction,
  leaveRoomAction,
  updateRoomAction,
} from "@/app/chat/actions";
import { notifyOrganizationChatRoomsChanged } from "@/components/chat/organization-chat-events";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import type { ChatRoom, Coworker, Member } from "@/lib/clients/generated/core";
import { ParticipantCheckboxes } from "./participant-checkboxes";

export function EditChannelDialog({
  channel,
  members,
  coworkers,
  canArchive,
  canLeave,
  membersLoadFailed = false,
}: {
  channel: ChatRoom;
  members: Member[];
  coworkers: Coworker[];
  /** Creator or organization owner/admin — archiving hides the room for
   * everyone. */
  canArchive: boolean;
  /** Any member can leave, except the last one: an empty roster could not be
   * archived by a remaining elevated member. */
  canLeave: boolean;
  membersLoadFailed?: boolean;
}) {
  const t = useTranslations("App.Channels");
  const tActions = useTranslations("App.Channels.Actions");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pendingKind, setPendingKind] = useState<"archive" | "leave" | null>(
    null,
  );
  const [isExiting, setIsExiting] = useState(false);
  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic ?? "");
  const [discoverability, setDiscoverability] = useState<"public" | "private">(
    channel.discoverability === "private" ? "private" : "public",
  );
  const [memberIds, setMemberIds] = useState<string[]>(
    channel.userMembers.map((member) => member.id),
  );
  const [coworkerIds, setCoworkerIds] = useState<string[]>(
    channel.coworkerMembers.map((coworker) => coworker.id),
  );
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setName(channel.name);
    setTopic(channel.topic ?? "");
    setDiscoverability(
      channel.discoverability === "private" ? "private" : "public",
    );
    setMemberIds(channel.userMembers.map((member) => member.id));
    setCoworkerIds(channel.coworkerMembers.map((coworker) => coworker.id));
  }, [channel, open]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await updateRoomAction(channel.id, {
        name,
        topic,
        ...(canArchive ? { discoverability } : {}),
        memberUserIds: memberIds,
        coworkerIds,
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  async function handleConfirmExit() {
    if (!pendingKind || isExiting) return;
    setIsExiting(true);
    const result =
      pendingKind === "archive"
        ? await archiveRoomAction(channel.id)
        : await leaveRoomAction(channel.id);
    setIsExiting(false);

    if (!result.ok) {
      toast.error(result.message);
      setPendingKind(null);
      return;
    }

    toast.success(
      pendingKind === "archive"
        ? tActions("archiveSuccess", { name: channel.name })
        : tActions("leaveSuccess", { name: channel.name }),
    );
    setPendingKind(null);
    setOpen(false);
    // Empty detail forces a full sidebar refresh (member list + joinables).
    notifyOrganizationChatRoomsChanged();
    // The room is gone for this user either way, so land them back on the
    // room list rather than a view they can no longer read.
    router.replace("/chat");
    router.refresh();
  }

  function handleRequestExit(kind: "archive" | "leave") {
    // Close settings before opening confirm so the two modals are not stacked
    // (nested focus traps). Confirm stays mounted as a true Dialog sibling.
    setOpen(false);
    setPendingKind(kind);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 rounded-full"
            aria-label={t("editChannel")}
            title={t("editChannel")}
          >
            <Settings2 className="size-4" aria-hidden />
          </Button>
        </DialogTrigger>
        {/* The fixed-height participant list makes this dialog ~755px tall, which
            overflows a shorter phone — on a 667px iPhone SE the title and close
            button sat above the viewport and Cancel below it, with nothing to
            scroll. Cap the dialog to the viewport and scroll the form body rather
            than the padded dialog box, whose children do not reflow around their
            own scrollbar. */}
        <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto shadow-none sm:max-w-2xl">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>{t("Dialog.editTitle")}</DialogTitle>
              <DialogDescription>
                {t("Dialog.editDescription")}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-channel-name">{t("Dialog.name")}</Label>
                <Input
                  id="edit-channel-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-channel-topic">{t("Dialog.topic")}</Label>
                <Textarea
                  id="edit-channel-topic"
                  value={topic}
                  onChange={(event) => setTopic(event.target.value)}
                  rows={3}
                />
              </div>
              {canArchive ? (
                <div className="space-y-2">
                  <Label>{t("Visibility.label")}</Label>
                  <RadioGroup
                    value={discoverability}
                    onValueChange={(value) => {
                      if (value === "public" || value === "private") {
                        setDiscoverability(value);
                      }
                    }}
                    className="flex flex-wrap gap-4"
                  >
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="public" id="edit-channel-public" />
                      <Label
                        htmlFor="edit-channel-public"
                        className="cursor-pointer font-normal"
                      >
                        {t("Visibility.public")}
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem
                        value="private"
                        id="edit-channel-private"
                      />
                      <Label
                        htmlFor="edit-channel-private"
                        className="cursor-pointer font-normal"
                      >
                        {t("Visibility.private")}
                      </Label>
                    </div>
                  </RadioGroup>
                  <p className="text-muted-foreground text-xs">
                    {discoverability === "public"
                      ? t("Visibility.publicHelp")
                      : t("Visibility.privateHelp")}
                  </p>
                </div>
              ) : null}
              <ParticipantCheckboxes
                members={members}
                coworkers={coworkers}
                memberIds={memberIds}
                coworkerIds={coworkerIds}
                onMemberIdsChange={setMemberIds}
                onCoworkerIdsChange={setCoworkerIds}
                membersLoadFailed={membersLoadFailed}
              />
            </div>
            {canArchive || canLeave ? (
              <div className="space-y-3 border-t pt-4">
                <p className="text-sm font-medium">
                  {tActions("sectionTitle")}
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  {canLeave ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="justify-center gap-2"
                      onClick={() => handleRequestExit("leave")}
                    >
                      <LogOut className="size-4" aria-hidden />
                      {tActions("leave")}
                    </Button>
                  ) : null}
                  {canArchive ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="text-semantic-destructive hover:text-semantic-destructive justify-center gap-2"
                      onClick={() => handleRequestExit("archive")}
                    >
                      <ArchiveIcon className="size-4" aria-hidden />
                      {tActions("archive")}
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
              >
                {t("Dialog.cancel")}
              </Button>
              <Button type="submit" variant="primary" disabled={isPending}>
                {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                {t("Dialog.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingKind !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !isExiting) setPendingKind(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingKind === "archive"
                ? tActions("archiveConfirmTitle", { name: channel.name })
                : tActions("leaveConfirmTitle", { name: channel.name })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingKind === "archive"
                ? tActions("archiveConfirmDescription", { name: channel.name })
                : tActions("leaveConfirmDescription", { name: channel.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isExiting}>
              {tActions("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isExiting}
              onClick={(event) => {
                // Keep the confirm mounted while the action runs, so the
                // spinner is visible and a second click cannot double-submit.
                event.preventDefault();
                void handleConfirmExit();
              }}
            >
              {isExiting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : null}
              {pendingKind === "archive"
                ? tActions("archiveConfirm")
                : tActions("leaveConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
