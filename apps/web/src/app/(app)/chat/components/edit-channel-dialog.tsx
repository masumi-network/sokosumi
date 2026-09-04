"use client";

import { Archive as ArchiveIcon, Loader2, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type FormEvent,
  type ReactElement,
  useEffect,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import type { ChatComposeOrchestrator } from "@/app/chat/actions";
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
import type { Discoverability } from "./create-channel-wizard";
import { GuestInviteSection } from "./guest-invite-section";
import { ParticipantCheckboxes } from "./participant-checkboxes";

function channelDiscoverability(
  value: ChatRoom["discoverability"],
): Discoverability {
  if (value === "private" || value === "external") {
    return value;
  }
  return "public";
}

function isDiscoverability(value: string): value is Discoverability {
  return value === "public" || value === "private" || value === "external";
}

/** Host-org roster only. Guests are room-scoped and must not be sent as memberUserIds. */
function hostRosterUserIds(channel: ChatRoom): string[] {
  return channel.userMembers
    .filter((member) => member.access !== "guest")
    .map((member) => member.id);
}

export function EditChannelDialog({
  channel,
  members,
  coworkers,
  sokoBots = [],
  currentUserId,
  canEditMembers,
  canManageSettings,
  canArchive,
  canLeave,
  canInviteGuests = false,
  membersLoadFailed = false,
  children,
}: {
  channel: ChatRoom;
  members: Member[];
  coworkers: Coworker[];
  sokoBots?: ChatComposeOrchestrator[];
  currentUserId: string;
  /** Any active channel member may rewrite the roster. */
  canEditMembers: boolean;
  /** Organization owner/admin — name/topic/discoverability. */
  canManageSettings: boolean;
  /** Organization owner/admin — archive the channel. */
  canArchive: boolean;
  /** Any member can leave. Host-org last member cannot; matched last member can. */
  canLeave: boolean;
  /**
   * Host-org room members (`myAccess=member`) on external channels may invite
   * guests. Guests never invite.
   */
  canInviteGuests?: boolean;
  membersLoadFailed?: boolean;
  /** Single element for DialogTrigger asChild; must accept merged props and ref. */
  children: ReactElement;
}) {
  const t = useTranslations("App.Channels");
  const tActions = useTranslations("App.Channels.Actions");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const showGuestInvite =
    canInviteGuests &&
    channelDiscoverability(channel.discoverability) === "external";
  const [guestMembers, setGuestMembers] = useState(() =>
    channel.userMembers.filter((member) => member.access === "guest"),
  );
  const [pendingKind, setPendingKind] = useState<"archive" | "leave" | null>(
    null,
  );
  const [isExiting, setIsExiting] = useState(false);
  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic ?? "");
  const [discoverability, setDiscoverability] = useState<Discoverability>(
    channelDiscoverability(channel.discoverability),
  );
  const [memberIds, setMemberIds] = useState<string[]>(() =>
    hostRosterUserIds(channel),
  );
  const [coworkerIds, setCoworkerIds] = useState<string[]>(
    channel.coworkerMembers.map((coworker) => coworker.id),
  );
  const [sokoBotIds, setOrchestratorIds] = useState<string[]>(
    channel.sokoBotMembers.map((sokoBot) => sokoBot.id),
  );
  const [isPending, startTransition] = useTransition();

  const canSubmit = canEditMembers || canManageSettings;
  const isActionsOnly = !canSubmit && (canLeave || canArchive);

  useEffect(() => {
    if (!open) return;
    setName(channel.name);
    setTopic(channel.topic ?? "");
    setDiscoverability(channelDiscoverability(channel.discoverability));
    setMemberIds(hostRosterUserIds(channel));
    setCoworkerIds(channel.coworkerMembers.map((coworker) => coworker.id));
    setOrchestratorIds(channel.sokoBotMembers.map((sokoBot) => sokoBot.id));
    setGuestMembers(
      channel.userMembers.filter((member) => member.access === "guest"),
    );
  }, [channel, open]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    startTransition(async () => {
      // Roster-only body when the caller cannot change settings (R3).
      const memberUserIds = memberIds.includes(currentUserId)
        ? memberIds
        : [currentUserId, ...memberIds];
      const result = await updateRoomAction(
        channel.id,
        canManageSettings
          ? {
              name,
              topic,
              discoverability,
              memberUserIds,
              coworkerIds,
              sokoBotIds,
            }
          : {
              memberUserIds,
              coworkerIds,
              sokoBotIds,
            },
      );
      if (!result.ok) {
        toast.error(result.error.message);
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
      toast.error(result.error.message);
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
    router.replace("/");
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
        <DialogTrigger asChild>{children}</DialogTrigger>
        {/* The fixed-height participant list makes this dialog ~755px tall, which
            overflows a shorter phone — on a 667px iPhone SE the title and close
            button sat above the viewport and Cancel below it, with nothing to
            scroll. Cap the dialog to the viewport and scroll the form body rather
            than the padded dialog box, whose children do not reflow around their
            own scrollbar. */}
        {/* Settings form stays separate from guest invite (nested forms invalid). */}
        <DialogContent className="max-h-[calc(100svh-2rem)] min-w-0 overflow-x-hidden overflow-y-auto px-5 py-6 shadow-none sm:max-w-2xl">
          <form className="min-w-0 space-y-4" onSubmit={handleSubmit}>
            <DialogHeader className="pr-6">
              <DialogTitle>
                {isActionsOnly
                  ? t("Dialog.actionsOnlyTitle")
                  : t("Dialog.editTitle")}
              </DialogTitle>
              <DialogDescription>
                {isActionsOnly
                  ? t("Dialog.actionsOnlyDescription")
                  : t("Dialog.editDescription")}
              </DialogDescription>
            </DialogHeader>
            {canManageSettings || canEditMembers ? (
              <div className="grid min-w-0 gap-4">
                {canManageSettings ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="edit-channel-name">
                        {t("Dialog.name")}
                      </Label>
                      <Input
                        id="edit-channel-name"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edit-channel-topic">
                        {t("Dialog.topic")}
                      </Label>
                      <Textarea
                        id="edit-channel-topic"
                        value={topic}
                        onChange={(event) => setTopic(event.target.value)}
                        rows={3}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{t("Visibility.label")}</Label>
                      <RadioGroup
                        value={discoverability}
                        onValueChange={(value) => {
                          if (isDiscoverability(value)) {
                            setDiscoverability(value);
                          }
                        }}
                        className="flex flex-wrap gap-4"
                      >
                        <div className="flex items-center gap-2">
                          <RadioGroupItem
                            value="public"
                            id="edit-channel-public"
                          />
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
                        <div className="flex items-center gap-2">
                          <RadioGroupItem
                            value="external"
                            id="edit-channel-external"
                          />
                          <Label
                            htmlFor="edit-channel-external"
                            className="cursor-pointer font-normal"
                          >
                            {t("Visibility.external")}
                          </Label>
                        </div>
                      </RadioGroup>
                      <p className="text-muted-foreground text-xs">
                        {discoverability === "public"
                          ? t("Visibility.publicHelp")
                          : discoverability === "private"
                            ? t("Visibility.privateHelp")
                            : t("Visibility.externalHelp")}
                      </p>
                    </div>
                  </>
                ) : null}
                {canEditMembers ? (
                  <ParticipantCheckboxes
                    members={members}
                    coworkers={coworkers}
                    sokoBots={sokoBots}
                    memberIds={memberIds}
                    coworkerIds={coworkerIds}
                    sokoBotIds={sokoBotIds}
                    lockedUserId={currentUserId}
                    onMemberIdsChange={setMemberIds}
                    onCoworkerIdsChange={setCoworkerIds}
                    onOrchestratorIdsChange={setOrchestratorIds}
                    membersLoadFailed={membersLoadFailed}
                  />
                ) : null}
              </div>
            ) : null}
            {canSubmit ? (
              <DialogFooter>
                <Button type="submit" variant="primary" disabled={isPending}>
                  {isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  {t("Dialog.save")}
                </Button>
              </DialogFooter>
            ) : null}
          </form>
          {/* Mount only while open so pending invites load on remount, not via open-synced Effect. */}
          {showGuestInvite && open ? (
            <div className="min-w-0">
              <GuestInviteSection
                key={channel.id}
                roomId={channel.id}
                guests={guestMembers}
                onGuestRemoved={(userId) => {
                  setGuestMembers((prev) =>
                    prev.filter((member) => member.id !== userId),
                  );
                  router.refresh();
                }}
              />
            </div>
          ) : null}
          {canArchive || canLeave ? (
            <div
              className={
                isActionsOnly ? "space-y-3 pt-1" : "space-y-3 border-t pt-4"
              }
            >
              {isActionsOnly ? null : (
                <p className="text-sm font-medium">
                  {tActions("sectionTitle")}
                </p>
              )}
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
