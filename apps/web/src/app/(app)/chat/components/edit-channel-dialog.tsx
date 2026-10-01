"use client";

import type { ChatRoom } from "@sokosumi/core-client";
import { Archive as ArchiveIcon, Loader2 } from "lucide-react";
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
import { archiveRoomAction, updateRoomAction } from "@/app/chat/actions";
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
import type { Discoverability } from "./create-channel-wizard";

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

/**
 * Channel settings for an organization owner or admin: name, topic,
 * visibility and Archive. Who is in the channel is managed in the members
 * panel, not here.
 */
export function EditChannelDialog({
  channel,
  open,
  onOpenChange: setOpen,
  onManageGuests,
  children,
}: {
  channel: ChatRoom;
  /**
   * The room shell owns the flag, because the dialog has two ways in: the
   * title beside the room name, and a channel row's overflow menu, which
   * cannot click that title and asks for the dialog on the URL instead.
   */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Close settings and show the members panel, where guests are removed. */
  onManageGuests: () => void;
  /** Single element for DialogTrigger asChild; must accept merged props and ref. */
  children: ReactElement;
}) {
  const t = useTranslations("App.Channels");
  const tActions = useTranslations("App.Channels.Actions");
  const router = useRouter();
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic ?? "");
  const [discoverability, setDiscoverability] = useState<Discoverability>(
    channelDiscoverability(channel.discoverability),
  );
  const [isPending, startTransition] = useTransition();
  // Core refuses to take an External channel Public or Private while it still
  // has guests (or open invites), so say so before the reader tries. Pending
  // invites and links are not on the room; Core's error covers those.
  const isVisibilityLocked =
    channel.discoverability === "external" &&
    channel.userMembers.some((member) => member.access === "guest");

  useEffect(() => {
    if (!open) return;
    setName(channel.name);
    setTopic(channel.topic ?? "");
    setDiscoverability(channelDiscoverability(channel.discoverability));
  }, [channel, open]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await updateRoomAction(channel.id, {
        name,
        topic,
        discoverability,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  async function handleConfirmArchive() {
    if (isArchiving) return;
    setIsArchiving(true);
    const result = await archiveRoomAction(channel.id);
    setIsArchiving(false);

    if (!result.ok) {
      toast.error(result.error.message);
      setArchiveConfirmOpen(false);
      return;
    }

    toast.success(tActions("archiveSuccess", { name: channel.name }));
    setArchiveConfirmOpen(false);
    setOpen(false);
    // Empty detail forces a full sidebar refresh (member list + joinables).
    notifyOrganizationChatRoomsChanged();
    // The room is gone, so land them back on the room list rather than a view
    // they can no longer read.
    router.replace("/");
    router.refresh();
  }

  function handleRequestArchive() {
    // Close settings before opening confirm so the two modals are not stacked
    // (nested focus traps). Confirm stays mounted as a true Dialog sibling.
    setOpen(false);
    setArchiveConfirmOpen(true);
  }

  function handleManageGuests() {
    setOpen(false);
    onManageGuests();
  }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>{children}</DialogTrigger>
        {/* Cap the dialog to the viewport and scroll the body, so a short
            phone still reaches the title, the close button and Save. */}
        <DialogContent className="app-scrollbar max-h-[calc(100dvh-2rem)] min-w-0 overflow-x-hidden overflow-y-auto px-5 py-6 shadow-none sm:max-w-lg">
          <form className="min-w-0 space-y-4" onSubmit={handleSubmit}>
            <DialogHeader className="pr-6">
              <DialogTitle>{t("Dialog.editTitle")}</DialogTitle>
              <DialogDescription>
                {t("Dialog.editDescription")}
              </DialogDescription>
            </DialogHeader>
            <div className="grid min-w-0 gap-4">
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
              <div className="space-y-2">
                <Label>{t("Visibility.label")}</Label>
                <RadioGroup
                  value={discoverability}
                  onValueChange={(value) => {
                    if (isDiscoverability(value)) {
                      setDiscoverability(value);
                    }
                  }}
                  aria-describedby={
                    isVisibilityLocked
                      ? "edit-channel-visibility-locked"
                      : undefined
                  }
                  className="flex flex-wrap gap-4"
                >
                  {(["public", "private", "external"] as const).map((value) => (
                    <div key={value} className="flex items-center gap-2">
                      <RadioGroupItem
                        className="peer"
                        value={value}
                        id={`edit-channel-${value}`}
                        disabled={isVisibilityLocked && value !== "external"}
                      />
                      <Label
                        htmlFor={`edit-channel-${value}`}
                        className="cursor-pointer font-normal"
                      >
                        {t(`Visibility.${value}`)}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
                {isVisibilityLocked ? (
                  <div className="flex flex-col items-start gap-1">
                    <p
                      id="edit-channel-visibility-locked"
                      className="text-muted-foreground text-xs"
                    >
                      {t("Visibility.externalLocked")}
                    </p>
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto p-0"
                      onClick={handleManageGuests}
                    >
                      {t("Dialog.manageGuests")}
                    </Button>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-xs">
                    {discoverability === "public"
                      ? t("Visibility.publicHelp")
                      : discoverability === "private"
                        ? t("Visibility.privateHelp")
                        : t("Visibility.externalHelp")}
                  </p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" variant="primary" disabled={isPending}>
                {isPending ? (
                  <Loader2 className="size-4 animate-spin motion-reduce:animate-pulse" />
                ) : null}
                {t("Dialog.save")}
              </Button>
            </DialogFooter>
          </form>
          <div className="space-y-3 border-t pt-4">
            <p className="text-sm font-medium">{tActions("sectionTitle")}</p>
            <Button
              type="button"
              variant="outline"
              className="text-semantic-destructive hover:text-semantic-destructive justify-center gap-2"
              onClick={handleRequestArchive}
            >
              <ArchiveIcon className="size-4" aria-hidden />
              {tActions("archive")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={archiveConfirmOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !isArchiving) setArchiveConfirmOpen(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {tActions("archiveConfirmTitle", { name: channel.name })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {tActions("archiveConfirmDescription", { name: channel.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isArchiving}>
              {tActions("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isArchiving}
              onClick={(event) => {
                // Keep the confirm mounted while the action runs, so the
                // spinner is visible and a second click cannot double-submit.
                event.preventDefault();
                void handleConfirmArchive();
              }}
            >
              {isArchiving ? (
                <Loader2
                  className="size-4 animate-spin motion-reduce:animate-pulse"
                  aria-hidden
                />
              ) : null}
              {tActions("archiveConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
