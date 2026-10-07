"use client";

import type { ChatRoom } from "@sokosumi/core-client";
import { Archive as ArchiveIcon } from "lucide-react";
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
  DialogClose,
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
import { cn } from "@/lib/utils";
import type { Discoverability } from "./create-channel-wizard";

function channelDiscoverability(
  value: ChatRoom["discoverability"],
): Discoverability {
  if (value === "private" || value === "external") {
    return value;
  }
  return "public";
}

const VISIBILITY_OPTIONS = ["public", "private", "external"] as const;

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

  const trimmedTopic = topic.trim();
  const hasChanges =
    name.trim() !== channel.name ||
    trimmedTopic !== (channel.topic ?? "") ||
    discoverability !== channelDiscoverability(channel.discoverability);

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

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>{children}</DialogTrigger>
        {/* Cap the dialog to the viewport and scroll the body, so a short
            phone still reaches the title, the close button and Save. */}
        <DialogContent className="app-scrollbar max-h-[calc(100dvh-2rem)] min-w-0 overflow-x-hidden overflow-y-auto px-5 py-6 shadow-none sm:max-w-lg">
          <form className="min-w-0 space-y-5" onSubmit={handleSubmit}>
            <DialogHeader className="pr-6">
              <DialogTitle>{t("Dialog.editTitle")}</DialogTitle>
              <DialogDescription>
                {channel.slug ? `#${channel.slug}` : channel.name}
              </DialogDescription>
            </DialogHeader>
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
              <Input
                id="edit-channel-topic"
                value={topic}
                placeholder={t("Dialog.topicPlaceholder")}
                onChange={(event) => setTopic(event.target.value)}
              />
            </div>
            <fieldset className="min-w-0 space-y-2">
              <legend className="mb-2 text-sm font-medium">
                {t("Visibility.label")}
              </legend>
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
                className="gap-2"
              >
                {VISIBILITY_OPTIONS.map((value) => {
                  const locked = isVisibilityLocked && value !== "external";
                  return (
                    <Label
                      key={value}
                      htmlFor={`edit-channel-${value}`}
                      className={cn(
                        "flex items-start gap-3 rounded-lg border p-3 font-normal",
                        value === discoverability
                          ? "border-primary bg-primary-quinary"
                          : "border-border",
                        locked
                          ? "cursor-not-allowed opacity-60"
                          : "cursor-pointer",
                      )}
                    >
                      <RadioGroupItem
                        className="mt-0.5"
                        value={value}
                        id={`edit-channel-${value}`}
                        disabled={locked}
                        aria-labelledby={`edit-channel-${value}-title`}
                        aria-describedby={`edit-channel-${value}-help`}
                      />
                      <span className="min-w-0 space-y-0.5">
                        <span className="flex items-center gap-2 text-sm font-medium">
                          <span id={`edit-channel-${value}-title`}>
                            {t(`Visibility.${value}`)}
                          </span>
                          {locked ? (
                            <span className="bg-semantic-warning-quinary text-semantic-warning-label rounded-full px-2 py-0.5 text-xs font-medium">
                              {t("Visibility.hasGuests")}
                            </span>
                          ) : null}
                        </span>
                        <span
                          id={`edit-channel-${value}-help`}
                          // Muted text falls under 4.5:1 on the selected
                          // card's tint, so only that card's goes full.
                          className={cn(
                            "block text-xs",
                            value === discoverability
                              ? "text-foreground"
                              : "text-muted-foreground",
                          )}
                        >
                          {t(`Visibility.${value}Help`)}
                        </span>
                      </span>
                    </Label>
                  );
                })}
              </RadioGroup>
              {isVisibilityLocked ? (
                <p
                  id="edit-channel-visibility-locked"
                  className="text-muted-foreground text-xs"
                >
                  {t("Visibility.externalLocked")}
                </p>
              ) : null}
            </fieldset>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {t("Dialog.cancel")}
                </Button>
              </DialogClose>
              <Button
                type="submit"
                variant="primary"
                disabled={!hasChanges}
                loading={isPending}
              >
                {t("Dialog.save")}
              </Button>
            </DialogFooter>
          </form>
          {/* Its own bordered box, apart from the form: archiving is rare and
              hides the channel for everyone, so it never sits beside Save. */}
          <section
            aria-labelledby="edit-channel-archive-title"
            className="border-semantic-destructive-tertiary mt-6 flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 space-y-0.5">
              <h3
                id="edit-channel-archive-title"
                className="text-sm font-medium"
              >
                {tActions("archive")}
              </h3>
              <p className="text-muted-foreground text-xs">
                {tActions("archiveHint")}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="text-semantic-destructive hover:text-semantic-destructive border-semantic-destructive-tertiary shrink-0 gap-2"
              onClick={handleRequestArchive}
            >
              <ArchiveIcon className="size-4" aria-hidden />
              {tActions("archiveButton")}
            </Button>
          </section>
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
              loading={isArchiving}
              onClick={(event) => {
                // Keep the confirm mounted while the action runs, so the
                // loading bar is visible and a second click cannot double-submit.
                event.preventDefault();
                void handleConfirmArchive();
              }}
            >
              {tActions("archiveConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
