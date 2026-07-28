"use client";

import { MessageCircle, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type FormEvent,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import {
  ensureCoworkerDirectRoomAction,
  sendNewDirectMessageAction,
} from "@/app/chat/actions";
import { stashPendingRoomMessage } from "@/app/chat/utils/pending-room-message";
import { notifyOrganizationChatRoomsChanged } from "@/components/chat/organization-chat-events";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { MentionRecordEntry } from "@/components/ui/mention-textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import type {
  ChatRoomCoworkerParticipant,
  Coworker,
  Member,
} from "@/lib/clients/generated/core";
import { getInitials } from "@/lib/utils/text";
import {
  ChannelComposer,
  type ChannelComposerAttachment,
} from "./channel-composer";
import {
  AiCoworkerIcon,
  buildDirectDraftTargets,
  type DirectDraftTarget,
  DirectDraftTargetList,
  filterDraftTargets,
} from "./channel-draft-shared";

export function DraftDirectMessage({
  members,
  coworkers,
  currentUserId,
  canCreateRoomDirect,
}: {
  members: Member[];
  coworkers: Coworker[];
  currentUserId: string;
  /** False in personal workspace — human 1:1 room DMs need an org. */
  canCreateRoomDirect: boolean;
}) {
  const t = useTranslations("App.Channels");
  const router = useRouter();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [recipientQuery, setRecipientQuery] = useState("");
  const [isRecipientPickerOpen, setIsRecipientPickerOpen] = useState(true);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [composerValue, setComposerValue] = useState("");
  const [composerAttachments, setComposerAttachments] = useState<
    ChannelComposerAttachment[]
  >([]);
  const [mentionedCoworkerIds, setMentionedCoworkerIds] = useState<string[]>(
    [],
  );
  const [isSending, startSendingTransition] = useTransition();
  const targets = useMemo(
    () => buildDirectDraftTargets(members, coworkers, currentUserId),
    [members, coworkers, currentUserId],
  );
  const selectedTargets = useMemo(() => {
    const byKey = new Map(targets.map((target) => [target.key, target]));
    return selectedKeys
      .map((key) => byKey.get(key))
      .filter((target): target is DirectDraftTarget => Boolean(target));
  }, [selectedKeys, targets]);
  const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const candidateTargets = useMemo(
    () => filterDraftTargets(targets, selectedKeySet, recipientQuery),
    [recipientQuery, selectedKeySet, targets],
  );
  const selectedCoworkerParticipants = useMemo<
    Record<string, MentionRecordEntry<ChatRoomCoworkerParticipant>>
  >(() => {
    return Object.fromEntries(
      selectedTargets
        .filter((target) => target.kind === "coworker" && target.slug)
        .map((target) => [
          target.id,
          {
            value: target.name,
            slug: target.slug ?? target.id,
            data: {
              id: target.id,
              name: target.name,
              slug: target.slug ?? target.id,
              caption: target.caption ?? null,
              image: target.image,
              presence: target.presence ?? "online",
            },
          },
        ]),
    );
  }, [selectedTargets]);
  const selectedMemberUserIds = selectedTargets
    .filter((target) => target.kind === "human")
    .map((target) => target.id);
  const selectedCoworkerIds = selectedTargets
    .filter((target) => target.kind === "coworker")
    .map((target) => target.id);

  function addTarget(target: DirectDraftTarget) {
    // Direct messages are 1:1 until group DM ships — selecting replaces.
    setSelectedKeys([target.key]);
    setRecipientQuery("");
    setIsRecipientPickerOpen(true);
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  function removeTarget(key: string) {
    setSelectedKeys((current) => current.filter((item) => item !== key));
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = composerValue.trim();
    if (!content) {
      return;
    }
    if (selectedTargets.length === 0) {
      toast.error(t("Draft.chooseRecipientError"));
      searchInputRef.current?.focus();
      return;
    }

    if (
      selectedMemberUserIds.length === 0 &&
      selectedCoworkerIds.length === 1
    ) {
      startSendingTransition(async () => {
        // Coworker 1:1 uses room stream — create room, stash draft, navigate.
        // Do not POST message here (mention dispatch is skipped; stream owns reply).
        const roomResult = await ensureCoworkerDirectRoomAction(
          selectedCoworkerIds[0],
        );
        if (!roomResult.ok) {
          toast.error(roomResult.message);
          return;
        }
        if (!roomResult.data) {
          toast.error("Could not ensure coworker direct room.");
          return;
        }

        stashPendingRoomMessage(roomResult.data.id, content);
        setComposerValue("");
        setComposerAttachments([]);
        setMentionedCoworkerIds([]);
        notifyOrganizationChatRoomsChanged(roomResult.data);
        router.replace(`/chat/rooms/${roomResult.data.id}`);
      });
      return;
    }

    if (!canCreateRoomDirect) {
      toast.error(t("Draft.organizationRequiredForGroup"));
      return;
    }

    if (selectedMemberUserIds.length !== 1 || selectedCoworkerIds.length > 0) {
      toast.error(t("Draft.oneToOneOnlyError"));
      return;
    }

    startSendingTransition(async () => {
      const result = await sendNewDirectMessageAction({
        memberUserIds: selectedMemberUserIds,
        coworkerIds: selectedCoworkerIds,
        content,
        mentionedCoworkerIds,
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setComposerValue("");
      setComposerAttachments([]);
      setMentionedCoworkerIds([]);
      notifyOrganizationChatRoomsChanged(result.data.channel);
      router.replace(`/chat/rooms/${result.data.channel.id}`);
    });
  }

  return (
    <>
      <header className="min-h-14 shrink-0 border-b px-5 py-2">
        <div className="relative flex w-full items-start gap-2">
          <span className="text-muted-foreground pt-2 text-sm font-medium">
            {t("Draft.to")}
          </span>
          <div className="flex min-h-10 min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {selectedTargets.map((target) => (
              <span
                key={target.key}
                className="bg-muted text-foreground inline-flex max-w-56 items-center gap-1.5 rounded-full py-1 pr-1 pl-1.5 text-sm"
              >
                <Avatar className="size-5">
                  <AvatarImage src={target.image ?? undefined} alt="" />
                  <AvatarFallback className="text-[9px]">
                    {getInitials(target.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="flex min-w-0 items-center gap-1">
                  <span className="truncate">{target.name}</span>
                  {target.kind === "coworker" ? (
                    <AiCoworkerIcon className="size-3" />
                  ) : null}
                </span>
                <button
                  type="button"
                  className="hover:bg-background/80 flex size-5 items-center justify-center rounded-full"
                  onClick={() => removeTarget(target.key)}
                  aria-label={t("Draft.removeRecipient", {
                    name: target.name,
                  })}
                >
                  <X className="size-3" aria-hidden />
                </button>
              </span>
            ))}
            <div className="relative min-w-44 flex-1">
              <Search
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-0 size-4 -translate-y-1/2"
                aria-hidden
              />
              <input
                ref={searchInputRef}
                value={recipientQuery}
                onChange={(event) => {
                  setRecipientQuery(event.target.value);
                  setIsRecipientPickerOpen(true);
                }}
                onFocus={() => setIsRecipientPickerOpen(true)}
                onBlur={() => {
                  window.setTimeout(() => setIsRecipientPickerOpen(false), 120);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && candidateTargets[0]) {
                    event.preventDefault();
                    addTarget(candidateTargets[0]);
                  }
                  if (
                    event.key === "Backspace" &&
                    recipientQuery.length === 0 &&
                    selectedKeys.length > 0
                  ) {
                    removeTarget(selectedKeys[selectedKeys.length - 1]);
                  }
                }}
                placeholder={
                  selectedTargets.length === 0
                    ? t("Draft.searchPlaceholder")
                    : t("Draft.searchPlaceholderReplace")
                }
                className="placeholder:text-muted-foreground h-9 w-full bg-transparent pr-2 pl-6 text-base outline-none md:text-sm"
              />
            </div>
          </div>
          {isRecipientPickerOpen ? (
            <div className="bg-popover text-popover-foreground border-border absolute top-full right-0 left-8 z-20 mt-1 max-h-72 overflow-y-auto rounded-md border p-1 shadow-lg">
              {candidateTargets.length > 0 ? (
                <DirectDraftTargetList
                  targets={candidateTargets}
                  onSelect={addTarget}
                />
              ) : (
                <p className="text-muted-foreground px-3 py-4 text-sm">
                  {t("Draft.noResults")}
                </p>
              )}
            </div>
          ) : null}
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex min-h-full w-full items-center justify-center px-5 py-10">
          <div className="max-w-md text-center">
            <MessageCircle className="text-muted-foreground mx-auto size-8" />
            <h2 className="mt-4 text-lg font-semibold">{t("Draft.title")}</h2>
            <p className="text-muted-foreground mt-2 text-sm">
              {selectedTargets.length > 0 ? t("Draft.ready") : t("Draft.empty")}
            </p>
          </div>
        </div>
      </ScrollArea>

      <ChannelComposer
        value={composerValue}
        onValueChange={setComposerValue}
        mentions={selectedCoworkerParticipants}
        onSelectedKeysChange={setMentionedCoworkerIds}
        placeholder={
          selectedTargets.length > 0
            ? t("Draft.composerPlaceholder")
            : t("Draft.composerPlaceholderNoRecipients")
        }
        attachments={composerAttachments}
        onAttachmentsChange={setComposerAttachments}
        onSubmit={handleSend}
        isSending={isSending}
        sendDisabled={
          composerValue.trim().length === 0 || selectedTargets.length === 0
        }
        showMentionShortcut={selectedTargets.length > 1}
      />
    </>
  );
}
