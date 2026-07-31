"use client";

import { Hash, Search, X } from "lucide-react";
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
import { sendNewChannelMessageAction } from "@/app/chat/actions";
import { notifyOrganizationChatRoomsChanged } from "@/components/chat/organization-chat-events";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { MentionRecordEntry } from "@/components/ui/mention-textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Coworker, Member } from "@/lib/clients/generated/core";
import { slugifyMentionValue } from "@/lib/utils/mention-parser";
import { getInitials } from "@/lib/utils/text";
import { RoomComposer, type RoomComposerAttachment } from "./room-composer";
import {
  AiCoworkerIcon,
  buildDirectDraftTargets,
  type DirectDraftTarget,
  DirectDraftTargetList,
  filterDraftTargets,
  MembersRosterLoadFailed,
} from "./room-draft-shared";
import type { RoomMentionParticipant } from "./room-helpers";

export function DraftChannel({
  members,
  coworkers,
  currentUserId,
  membersLoadFailed = false,
}: {
  members: Member[];
  coworkers: Coworker[];
  currentUserId: string;
  membersLoadFailed?: boolean;
}) {
  const t = useTranslations("App.Channels");
  const router = useRouter();
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [recipientQuery, setRecipientQuery] = useState("");
  const [isRecipientPickerOpen, setIsRecipientPickerOpen] = useState(true);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [composerValue, setComposerValue] = useState("");
  const [composerAttachments, setComposerAttachments] = useState<
    RoomComposerAttachment[]
  >([]);
  const [mentionedIds, setMentionedIds] = useState<string[]>([]);
  const [isCreating, startCreatingTransition] = useTransition();
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
  const selectedMentionParticipants = useMemo<
    Record<string, MentionRecordEntry<RoomMentionParticipant>>
  >(() => {
    return Object.fromEntries(
      selectedTargets.map((target) => {
        const slug =
          target.kind === "coworker"
            ? (target.slug ?? target.id)
            : slugifyMentionValue(target.name);
        const participant: RoomMentionParticipant = {
          kind: target.kind,
          id: target.id,
          name: target.name,
          slug,
          image: target.image,
        };
        return [
          target.id,
          {
            value: target.name,
            slug,
            data: participant,
          },
        ];
      }),
    );
  }, [selectedTargets]);
  const selectedMemberUserIds = selectedTargets
    .filter((target) => target.kind === "human")
    .map((target) => target.id);
  const selectedCoworkerIds = selectedTargets
    .filter((target) => target.kind === "coworker")
    .map((target) => target.id);
  const selectedCoworkerIdSet = useMemo(
    () => new Set(selectedCoworkerIds),
    [selectedCoworkerIds],
  );
  const selectedMemberUserIdSet = useMemo(
    () => new Set(selectedMemberUserIds),
    [selectedMemberUserIds],
  );
  const trimmedName = name.trim();
  const displayName = trimmedName || t("Dialog.createTitle");

  function addTarget(target: DirectDraftTarget) {
    setSelectedKeys((current) =>
      current.includes(target.key) ? current : [...current, target.key],
    );
    setRecipientQuery("");
    setIsRecipientPickerOpen(true);
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  function removeTarget(key: string) {
    setSelectedKeys((current) => current.filter((item) => item !== key));
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = composerValue.trim();
    if (!trimmedName) {
      toast.error(t("Dialog.nameRequired"));
      nameInputRef.current?.focus();
      return;
    }
    if (!content) {
      return;
    }

    startCreatingTransition(async () => {
      const mentionedCoworkerIds = mentionedIds.filter((id) =>
        selectedCoworkerIdSet.has(id),
      );
      const mentionedUserIds = mentionedIds.filter((id) =>
        selectedMemberUserIdSet.has(id),
      );
      const result = await sendNewChannelMessageAction({
        name: trimmedName,
        topic,
        memberUserIds: selectedMemberUserIds,
        coworkerIds: selectedCoworkerIds,
        content,
        mentionedCoworkerIds,
        mentionedUserIds,
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setName("");
      setTopic("");
      setSelectedKeys([]);
      setComposerValue("");
      setComposerAttachments([]);
      setMentionedIds([]);
      notifyOrganizationChatRoomsChanged(result.data.room);
      router.replace(`/chat/rooms/${result.data.room.id}`);
    });
  }

  return (
    <>
      <header className="min-h-14 shrink-0 border-b px-5 py-2">
        <div className="space-y-2">
          <div className="flex w-full items-start gap-2">
            <Hash
              className="text-muted-foreground mt-2 size-4 shrink-0"
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <input
                ref={nameInputRef}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("Dialog.namePlaceholder")}
                className="placeholder:text-muted-foreground h-8 w-full bg-transparent text-base font-medium outline-none md:text-sm"
              />
              <input
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                placeholder={t("Dialog.topicPlaceholder")}
                className="placeholder:text-muted-foreground/80 text-muted-foreground h-6 w-full bg-transparent text-base outline-none md:text-xs"
              />
            </div>
          </div>

          <div className="relative flex w-full items-start gap-2">
            <span className="text-muted-foreground pt-2 text-sm font-medium">
              {t("Dialog.participants")}
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
                    className="hover:bg-background/80 relative flex size-5 items-center justify-center rounded-full before:absolute before:-inset-2 before:content-['']"
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
                    window.setTimeout(
                      () => setIsRecipientPickerOpen(false),
                      120,
                    );
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
                      : t("Draft.searchPlaceholderMore")
                  }
                  className="placeholder:text-muted-foreground h-9 w-full bg-transparent pr-2 pl-6 text-base outline-none md:text-sm"
                />
              </div>
            </div>
            {isRecipientPickerOpen ? (
              <div className="bg-popover text-popover-foreground border-border absolute top-full right-0 left-0 z-20 mt-1 max-h-72 overflow-y-auto rounded-md border p-1 shadow-lg">
                {membersLoadFailed ? (
                  <MembersRosterLoadFailed className="m-1 px-3 py-6" />
                ) : null}
                {candidateTargets.length > 0 ? (
                  <DirectDraftTargetList
                    targets={candidateTargets}
                    onSelect={addTarget}
                  />
                ) : membersLoadFailed ? null : (
                  <p className="text-muted-foreground px-3 py-4 text-sm">
                    {t("Draft.noResults")}
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex min-h-full w-full items-center justify-center px-5 py-10">
          <div className="max-w-md text-center">
            <Hash className="text-muted-foreground mx-auto size-8" />
            <h2 className="mt-4 text-lg font-semibold">
              {trimmedName ? `# ${displayName}` : t("Dialog.createTitle")}
            </h2>
            <p className="text-muted-foreground mt-2 text-sm">
              {selectedTargets.length > 0
                ? t("Dialog.selectedParticipants", {
                    count: selectedTargets.length,
                  })
                : t("Empty.noChannelDescription")}
            </p>
          </div>
        </div>
      </ScrollArea>

      <RoomComposer
        value={composerValue}
        onValueChange={setComposerValue}
        mentions={selectedMentionParticipants}
        onSelectedKeysChange={setMentionedIds}
        placeholder={
          trimmedName
            ? t("Draft.composerPlaceholder")
            : t("Dialog.namePlaceholder")
        }
        attachments={composerAttachments}
        onAttachmentsChange={setComposerAttachments}
        onSubmit={handleCreate}
        isSending={isCreating}
        sendDisabled={trimmedName.length === 0 || composerValue.trim() === ""}
      />
    </>
  );
}
